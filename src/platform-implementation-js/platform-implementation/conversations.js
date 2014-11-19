var _ = require('lodash');

var BasicClass = require('../lib/basic-class');


var ThreadView = require('../views/thread-view');
var MessageView = require('../views/message-view');

var HandlerRegistry = require('../lib/handler-registry');

var Conversations = function(appId, driver){
	BasicClass.call(this);

	this._appId = appId;
	this._driver = driver;

	this._threadViewHandlerRegistry = new HandlerRegistry();
	this._messageViewHandlerRegistry = new HandlerRegistry();

	this._setupThreadViewDriverWatcher();
	this._setupMessageViewDriverWatcher();
};

Conversations.prototype = Object.create(BasicClass.prototype);

_.extend(Conversations.prototype, {

	__memberVariables:[
		{name: '_appId', destroy: false},
		{name: '_driver', destroy: false},
		{name: '_threadViewUnsubscribeFunction', destroy: true, defaultValue: []},
		{name: '_messageViewUnsubscribeFunction', destroy: true, defaultValue: []},
		{name: '_threadViewHandlerRegistry', destroy: true},
		{name: '_messageViewHandlerRegistry', destroy: true}
	],

	registerThreadViewHandler: function(handler){
		return this._threadViewHandlerRegistry.addHandler(handler);
	},

	registerMessageViewHandler: function(handler){
		return this._messageViewHandlerRegistry.addHandler(handler);
	},

	_setupThreadViewDriverWatcher: function(){
		this._threadViewUnsubscribeFunction = this._setupViewDriverWatcher('getThreadViewDriverStream', ThreadView, this._threadViewHandlerRegistry);
	},

	_setupMessageViewDriverWatcher: function(){
		this._messageViewUnsubscribeFunction = this._setupViewDriverWatcher('getMessageViewDriverStream', MessageView, this._messageViewHandlerRegistry);
	},

	_setupViewDriverWatcher: function(driverStreamGetFunction, viewClass, handlerRegistry){
		var self = this;
		return this._driver[driverStreamGetFunction]().onValue(function(viewDriver){
			var view = new viewClass(viewDriver);
			handlerRegistry.addTarget(view);
		});
	}

});

module.exports = Conversations;
