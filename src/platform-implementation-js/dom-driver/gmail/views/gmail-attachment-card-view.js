var _ = require('lodash');
var AttachmentCardViewDriver = require('../../../driver-interfaces/attachment-card-view-driver');

var ButtonView = require('../widgets/buttons/button-view');
var BasicButtonViewController = require('../../../widgets/buttons/basic-button-view-controller');

var simulateClick = require('../../../lib/dom/simulate-click');
var waitFor = require('../../../lib/wait-for');

var GmailAttachmentCardView = function(options){
	AttachmentCardViewDriver.call(this);

	if(options.element){
		this._element = options.element;
		this.ready().then(this._extractAttachmentInfo.bind(this));
	}
	else{
		this._createNewElement(options);
	}
};

GmailAttachmentCardView.prototype = Object.create(AttachmentCardViewDriver.prototype);

_.extend(GmailAttachmentCardView.prototype, {

	__memberVariables: [
		{name: '_element', destroy: false, get: true},
		{name: '_title', destroy: false, get: true},
		{name: '_mimeType', destroy: false, get: true},
		{name: '_messageId', destroy: false},
		{name: '_attachmentId', destroy: false}
	],

	ready: function(){
		var self = this;
		return waitFor(function(){
			return !self._isStandardAttachment() || (self._isStandardAttachment() && self._element.querySelector('.aQw') && self._element.querySelector('.aQw').children.length > 0);
		});
	},

	getAttachmentType: function(){
		if(this._isStandardAttachment()){
			return 'FILE';
		}

		if(this._isDriveAttachment()){
			return 'DRIVE';
		}

		if(this._isNonNativeAttachment()){
			return 'CUSTOM';
		}
	},

	addButton: function(options){
		var buttonView = new ButtonView({
			iconUrl: options.iconUrl,
			tooltip: options.tooltip
		});

		var basicButtonViewController = new BasicButtonViewController({
			activateFunction: function(){
				if(options.onClick){
					options.onClick();
				}
			},
			buttonView: buttonView
		});

		this._addButton(buttonView);
	},

	_extractAttachmentInfo: function(){
		if(!this._isStandardAttachment()){
			return;
		}

		var downloadUrl = this._element.getAttribute('download_url');
		var imageUrl = this._getPreviewImageUrl();

		var attachmentUrl = downloadUrl || imageUrl;

		if(downloadUrl){
			var parts = downloadUrl.split(':');
			if(parts.length === 4){
				this._mimeType = parts[0];
			}
		}
		else{
			this._mimeType = 'unknown';
		}


		this._title = this._extractFileNameFromElement();
		this._messageId = attachmentUrl.replace(/.*?th=(\w+?)\&.*/, '$1');
		this._attachmentId = attachmentUrl.replace(/.*?realattid=(.+)(\&.*|^)/, '$1');
	},

	_isStandardAttachment: function(){
		return !this._isDriveAttachment() && !this._isNonNativeAttachment() && !!this._getButtonContainerElement();
	},

	_isDriveAttachment: function(){
		var previewImageUrl = this._getPreviewImageUrl();
		if(!previewImageUrl){
			return false;
		}

		return !!previewImageUrl.match(/https?:\/\/\w+\.googleusercontent\.com/);
	},

	_isNonNativeAttachment: function() {
		return _.contains(this._element.classList, 'inboxsdk__attachmentCard');
	},

	_extractFileNameFromElement: function(){
		return this._element.querySelector('.aQA > span').textContent;
	},

	_createNewElement: function(options){
		this._element = document.createElement('span');
		this._element.classList.add('aZo');
		this._element.classList.add('inboxsdk__attachmentCard');

		this._element.innerHTML = [
			'<a target="_blank" role="link" class="aQy e" href="">',
				'<div aria-hidden="true">',
					'<div class="aSG"></div>',
					'<div class="aVY aZn">',
						'<div class="aZm"></div>',
					'</div>',
					'<div class="aSH">',
						'<img class="aQG aYB" src="">',
						'<div class="aYy">',
							'<div class="aYA">',
								'<img class="aSM" src="">',
							'</div>',
							'<div class="aYz">',
								'<div class="a12">',
									'<div class="aQA">',
										'<span class="aV3 a6U"></span>',
									'</div>',
									'<div class="aYp">',
										'<span class="SaH2Ve"></span>',
									'</div>',
								'</div>',
							'</div>',
						'</div>',
					'</div>',
					'<div class="aSI">',
						'<div class="aSJ"></div>',
					'</div>',
				'</div>',
			'</a>',
			'<div class="aQw">',
			'</div>'
		].join('');

		this._element.children[0].href = options.previewUrl;
		this._element.querySelector('img.aYB').src = options.previewThumbnailUrl;
		this._element.querySelector('img.aSM').src = options.fileIconImageUrl;
		this._element.querySelector('span .aV3').textContent = options.title;
		this._element.querySelector('div.aYp > span').textContent = options.description || '';
		this._element.querySelector('div.aSJ').style.borderColor = options.foldColor;

		this._addHoverEvents();

		if(options.buttons){
			var downloadButton = _.find(options.buttons, function(button){
				return button.downloadUrl;
			});

			if(downloadButton){
				this._addDownloadButton(downloadButton);
			}


			this._addMoreButtons(options.buttons);
		}

		var self = this;
		this._element.addEventListener('click', function(e){
			if(options.previewOnClick){
				options.previewOnClick({
					attachmentCardView: self,
					preventDefault: function(){
						e.preventDefault();
					}
				});
			}
		});

		this._title = options.fileName;
	},

	_addHoverEvents: function(){
		var self = this;
		this._element.addEventListener(
			'mouseenter',
			function(){
				self._element.classList.add('aZp');
			}
		);

		this._element.addEventListener(
			'mouseleave',
			function(){
				self._element.classList.remove('aZp');
			}
		);

	},

	_addDownloadButton: function(options){
		var buttonView = new ButtonView({
			tooltip: 'Download',
			iconClass: 'aSK J-J5-Ji aYr'
		});

		var basicButtonViewController = new BasicButtonViewController({
			activateFunction: function(){
				var prevented = false;

				if(options.onClick){
					options.onClick({
						preventDefault: function(){
							prevented = true;
						}
					});
				}

				if(prevented){
					return;
				}

				var downloadLink = document.createElement('a');
				downloadLink.href = options.downloadUrl;

				downloadLink.addEventListener('click', function(e) {
					e.stopImmediatePropagation();
					e.stopPropagation();
				}, true);

				document.body.appendChild(downloadLink);

				simulateClick(downloadLink);
				downloadLink.remove();
			},
			buttonView: buttonView
		});

		this._addButton(buttonView);
	},

	_addMoreButtons: function(buttonDescriptors){
		_.chain(buttonDescriptors)
			.filter(function(buttonDescriptor){
				return !buttonDescriptor.downloadUrl;
			})
			.map(function(buttonDescriptor){
				var buttonView = new ButtonView(buttonDescriptor);
				var buttonViewController = new BasicButtonViewController({
					buttonView: buttonView,
					activateFunction: buttonDescriptor.onClick
				});

				return buttonView;
			})
			.each(this._addButton.bind(this));
	},

	_addButton: function(buttonView){
		buttonView.addClass('aQv');

		this._getButtonContainerElement().appendChild(buttonView.getElement());
	},

	_getPreviewImageUrl: function(){
		var previewImage = this._getPreviewImage();
		if(!previewImage){
			return null;
		}

		return previewImage.src;
	},

	_getPreviewImage: function(){
		return this._element.querySelector('img.aQG');
	},

	_getButtonContainerElement: function(){
		return this._element.querySelector('.aQw');
	}

});

module.exports = GmailAttachmentCardView;
