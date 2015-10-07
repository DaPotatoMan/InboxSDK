/* @flow */
//jshint ignore:start

var _ = require('lodash');
var RSVP = require('rsvp');

var Bacon = require('baconjs');
var Kefir = require('kefir');
import baconCast from 'bacon-cast';
import kefirStopper from 'kefir-stopper';
var ud = require('ud');

import Logger from '../../lib/logger';
import injectScript from '../../lib/inject-script';
import customStyle from './custom-style';
import censorHTMLstring from '../../../common/censor-html-string';
import censorHTMLtree from '../../../common/censor-html-tree';
import getComposeViewDriverStream from './get-compose-view-driver-stream';
import kefirWaitFor from '../../lib/kefir-wait-for';
import kefirDelayAsap from '../../lib/kefir-delay-asap';
import kmakeElementChildStream from '../../lib/dom/kefir-make-element-child-stream';
import kefirElementViewMapper from '../../lib/dom/kefir-element-view-mapper';
import kmakeMutationObserverStream from '../../lib/dom/kefir-make-mutation-observer-stream';
import kmakeMutationObserverChunkedStream from '../../lib/dom/kefir-make-mutation-observer-chunked-stream';

import InboxRouteView from './views/inbox-route-view';
import InboxComposeView from './views/inbox-compose-view';
import InboxPageCommunicator from './inbox-page-communicator';
import InboxModalView from './views/inbox-modal-view';
import type ButterBar from '../../platform-implementation/butter-bar';
import type {Driver, ShortcutDescriptor} from '../../driver-interfaces/driver';
import type {ComposeViewDriver} from '../../driver-interfaces/compose-view-driver';
import type {EnvData} from '../../platform-implementation';

var InboxDriver = ud.defn(module, class InboxDriver {
  _logger: Logger;
  _envData: EnvData;
  _stopper: Kefir.Stream&{destroy:()=>void};
  onready: Promise;
  _routeViewDriverStream: Bacon.Observable;
  _rowListViewDriverStream: Bacon.Observable;
  _composeViewDriverStream: Bacon.Observable<ComposeViewDriver>;
  _threadViewDriverStream: Bacon.Observable;
  _messageViewDriverStream: Bacon.Observable;
  _threadRowViewDriverKefirStream: Kefir.Stream;
  _toolbarViewDriverStream: Bacon.Observable;
  _butterBarDriver: Object;
  _butterBar: ButterBar;
  _pageCommunicator: InboxPageCommunicator;

  constructor(appId: string, LOADER_VERSION: string, IMPL_VERSION: string, logger: Logger, envData: EnvData) {
    customStyle();
    this._logger = logger;
    this._envData = envData;
    this._stopper = kefirStopper();
    this._pageCommunicator = new InboxPageCommunicator();
    this.onready = injectScript().then(() => {
      this._logger.setUserEmailAddress(this.getUserEmailAddress());
    });

    // this._customRouteIDs = new Set();
    // this._customListRouteIDs = new Map();
    // this._customListSearchStringsToRouteIds = new Map();

    /*
    var mainAdds = streamWaitFor(() => document.getElementById('mQ'))
      .flatMap(el => makeElementChildStream(el));

    // tNsA5e-nUpftc nUpftc lk
    var mainViews = mainAdds.filter(({el}) => el.classList.contains('lk'))
      .map(({el}) => el.querySelector('div.cz[jsan]'))
      .flatMap(el =>
        makeMutationObserverChunkedStream(el, {
          attributes: true, attributeFilter: ['jsan']
        }).toProperty(null).map(() => el)
      )
      .map(el => ({el, jsan: el.getAttribute('jsan')}))
      .skipDuplicates((a, b) => a.jsan === b.jsan)
      .map(({el, jsan}) => new InboxRouteView(el));

    // tNsA5e-nUpftc nUpftc i5 xpv2f
    var searchViews = mainAdds.filter(({el}) =>
        !el.classList.contains('lk') &&
        el.classList.contains('i5') && el.classList.contains('xpv2f')
      )
      .map(({el}) => new InboxRouteView(el));
    */

    this._routeViewDriverStream = Bacon.never().toProperty(); //Bacon.mergeAll(mainViews, searchViews);
    this._rowListViewDriverStream = Bacon.never();
    this._composeViewDriverStream = baconCast(Bacon,
      getComposeViewDriverStream(this).takeUntilBy(this._stopper)
    );
    this._threadViewDriverStream = Bacon.never();
    this._messageViewDriverStream = Bacon.never();
    this._threadRowViewDriverKefirStream = Kefir.never();
    this._toolbarViewDriverStream = Bacon.never();

    this._composeViewDriverStream.onError(err => {
      // If we get here, it's probably because of a waitFor timeout caused by
      // us failing to find the compose parent. Let's log the results of a few
      // similar selectors to see if our selector was maybe slightly wrong.
      function getStatus() {
        return {
          mainLength: document.querySelectorAll('[role=main]').length,
          regularLength: document.querySelectorAll('body > div[id][jsan] > div[id][class]:not([role]) > div[class] > div[id]:first-child').length,
          noFirstChildLength: document.querySelectorAll('body > div[id][jsan] > div[id][class]:not([role]) > div[class] > div[id]').length,
          noDirectNoFirstChildLength: document.querySelectorAll('body div[id][jsan] div[id][class] div[class] div[id]:first-child:not([jsan]):not([class])').length,
          // We can use class names for logging heuristics. Don't want to use
          // them anywhere else.
          classLength: document.querySelectorAll('div.ek div.md > div').length,
          classEkLength: document.querySelectorAll('.ek').length,
          classMdLength: document.querySelectorAll('.md').length,
          composeHtml: _.map(document.querySelectorAll('body > div[id][jsan] > div[id][class]:not([role]) > div[class] > div[id]:first-child, div.ek div.md > div'), el => censorHTMLtree(el))
        };
      }

      var startStatus = getStatus();
      var waitTime = 180*1000;
      this._logger.error(err, startStatus);
      setTimeout(() => {
        var laterStatus =  getStatus();
        this._logger.eventSdkPassive('waitfor compose data', {
          startStatus, waitTime, laterStatus
        });
      }, waitTime);
    });
  }

  destroy() {
    this._stopper.destroy();
  }

  getLogger(): Logger {return this._logger;}
  getStopper(): Kefir.Stream {return this._stopper;}
  getRouteViewDriverStream(): Bacon.Observable {return this._routeViewDriverStream;}
  getRowListViewDriverStream(): Bacon.Observable {return this._rowListViewDriverStream;}
  getComposeViewDriverStream(): Bacon.Observable {return this._composeViewDriverStream;}
  getThreadViewDriverStream(): Bacon.Observable {return this._threadViewDriverStream;}
  getMessageViewDriverStream(): Bacon.Observable {return this._messageViewDriverStream;}
  getThreadRowViewDriverKefirStream(): Kefir.Stream {return this._threadRowViewDriverKefirStream;}
  getToolbarViewDriverStream(): Bacon.Observable {return this._toolbarViewDriverStream;}
  getButterBarDriver(): Object {return this._butterBarDriver;}
  getButterBar(): ButterBar {return this._butterBar;}
  setButterBar(bb: ButterBar) {this._butterBar = bb;}
  getPageCommunicator(): InboxPageCommunicator {return this._pageCommunicator;}

  openComposeWindow(): void {
    throw new Error("Not implemented");
  }

  createKeyboardShortcutHandle(shortcutDescriptor: ShortcutDescriptor, appId: string, appName: ?string, appIconUrl: ?string): Object {
		// stub
    return {};
	}

  getUserEmailAddress(): string {
    return document.head.getAttribute('data-inboxsdk-user-email-address');
  }

  getUserContact(): Contact {
    return {
      emailAddress: this.getUserEmailAddress(),
      name: this.getUserEmailAddress()
    };
  }

  addNavItem(appId: string, navItemDescriptor: Object): Object {
    console.log('addNavItem not implemented');
    return {
      getEventStream: _.constant(Bacon.never())
    };
  }

  getSentMailNativeNavItem(): Promise<Object> {
    // stub, never resolve
    console.log('getSentMailNativeNavItem not implemented');
    return new Promise((resolve, reject) => {});
  }

  createLink(routeID: string, params: ?{[ix: string]: string}): any {
    throw new Error("Not implemented");
  }

  goto(routeID: string, params: ?{[ix: string]: string}): void {
    throw new Error("Not implemented");
  }

  addCustomRouteID(routeID: string): () => void {
    console.log('addCustomRouteID not implemented');
    return _.noop;
  }

  addCustomListRouteID(routeID: string, handler: Function): () => void {
    console.log('addCustomListRouteID not implemented');
    return _.noop;
  }

  showCustomRouteView(element: HTMLElement): void {
    throw new Error("Not implemented");
  }

  setShowNativeNavMarker(value: boolean) {
    // stub
  }

  registerSearchSuggestionsProvider(handler: Function) {
    console.log('registerSearchSuggestionsProvider not implemented');
  }

  registerSearchQueryRewriter(obj: Object) {
    console.log('registerSearchQueryRewriter not implemented');
  }

  addToolbarButtonForApp(buttonDescriptor: Object): Promise {
    console.log('addToolbarButtonForApp not implemented');
    return new Promise((resolve, reject) => {});
  }

  isRunningInPageContext(): boolean {
    return !!(global.gbar && global.gbar._CONFIG);
  }

  showAppIdWarning() {
    // stub
  }

  openDraftByMessageID(messageID: string): void {
    throw new Error("Not implemented");
  }

  createMoleViewDriver(options: Object): Object {
    throw new Error("Not implemented");
  }

  createModalViewDriver(options: Object): InboxModalView {
    return new InboxModalView(options);
  }
});
export default InboxDriver;

// This function does not get executed. It's only checked by Flow to make sure
// this class successfully implements the type interface.
function __interfaceCheck() {
	var driver: Driver = new InboxDriver('', '', '', ({}:any), ({}:any));
}
