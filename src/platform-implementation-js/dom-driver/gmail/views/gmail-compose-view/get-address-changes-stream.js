/* @flow */

import Kefir from 'kefir';
import t from 'transducers.js';

import Logger from '../../../../lib/logger';
import makeMutationObserverStream from '../../../../lib/dom/make-mutation-observer-stream';
import getAddressInformationExtractor from './get-address-information-extractor';

import type GmailComposeView from '../gmail-compose-view';

export default function getAddressChangesStream(gmailComposeView: GmailComposeView): Kefir.Observable<Object> {
	const recipientRowElements = gmailComposeView.getRecipientRowElements();

	if(!recipientRowElements || recipientRowElements.length === 0){
		return Kefir.never();
	}

	const mergedStream = Kefir.merge([
		_makeSubAddressStream('to', gmailComposeView),
		_makeSubAddressStream('cc', gmailComposeView),
		_makeSubAddressStream('bcc', gmailComposeView)
	]);

	const umbrellaStream = mergedStream.map(_groupChangeEvents);

	return Kefir.merge([mergedStream, umbrellaStream, getFromAddressChangeStream(gmailComposeView)]);
}

function _makeSubAddressStream(addressType: ReceiverType, gmailComposeView: GmailComposeView) {
	let contactRow;
	try {
		contactRow = gmailComposeView.getRecipientRowForType(addressType);
	} catch (err) {
		Logger.error(err, {addressType});
		return Kefir.never();
	}

	const mainSubAddressStream =
		makeMutationObserverStream(
			contactRow,
			{
				childList: true,
				subtree: true
			}
		);

	return Kefir.later(0, null).flatMap(function() {
		return Kefir.merge([

			mainSubAddressStream
				.toProperty(() => {
					return {addedNodes: contactRow.querySelectorAll('.vR')};
				})
				.transduce(t.compose(
					t.mapcat(e => Array.from(e.addedNodes)),
					t.filter(_isRecipientNode),
					t.map(getAddressInformationExtractor(addressType, gmailComposeView)),
					t.keep(),
					t.map(info => _convertToEvent(addressType + 'ContactAdded', info))
				)),

			mainSubAddressStream
				.transduce(t.compose(
					t.mapcat(e => Array.from(e.removedNodes)),
					t.filter(_isRecipientNode),
					t.map(getAddressInformationExtractor(addressType, gmailComposeView)),
					t.keep(),
					t.map(info => _convertToEvent(addressType + 'ContactRemoved', info))
				))
		]);
	});
}

function _isRecipientNode(node){
	// We want to filter non-element nodes out too.
	return node.classList && node.classList.contains('vR');
}


function _groupChangeEvents(event){
	const grouping = {
		to: {
			added: [],
			removed: []
		},
		cc: {
			added: [],
			removed: []
		},
		bcc: {
			added: [],
			removed: []
		}
	};

	const parts = event.eventName.split('Contact'); //splits "toContactAdded" => ["to", "Added"]
	grouping[parts[0]][parts[1].toLowerCase()].push(event.data.contact);

	return {
		eventName: 'recipientsChanged',
		data: grouping
	};
}


function getFromAddressChangeStream(gmailComposeView){
	return Kefir.later(0, null).flatMap(() => {
		const fromInput = gmailComposeView.getElement().querySelector('input[name="from"]');
		return Kefir.constant(_convertToEvent('fromContactChanged', gmailComposeView.getFromContact()))
			.merge(
				!fromInput ? Kefir.never() : makeMutationObserverStream(
					fromInput,
					{attributes: true, attributeFilter: ['value']}
				)
				.map(() =>
					_convertToEvent('fromContactChanged', gmailComposeView.getFromContact())
				)
			);
	});
}

function _convertToEvent(eventName, addressInfo){
	return {
		eventName,
		data: {
			contact: addressInfo
		}
	};
}
