/* eslint-disable prefer-rest-params */
import has from 'lodash/has';
import noop from 'lodash/noop';
import each from 'lodash/each';
import filter from 'lodash/filter';
import includes from 'lodash/includes';
import once from 'lodash/once';
import { assert } from '../common/assert';
import EventEmitter from 'events';
import { parse as deparam } from 'querystring';
import isNotNil from '../common/isNotNil';
export type Opts = {
  logError: (error: unknown, details?: any) => void;
};
const WARNING_TIMEOUT = 60 * 1000;

/**
 * Object with information about the connection in progress. Its fields are
 * populated as the connection goes on. The object is passed as the first
 * argument to all of the wrappers. The object is mutable so the wrappers can
 * add properties to it.
 *
 * @typedef {Object} XHRProxyConnectionDetails
 * @property {string} method
 * @property {string} url
 * @property {Object} params - parameters decoded from the URL
 * @property {Object} headers - request headers set on the XHR
 * @property {string} responseType
 * @property {string} originalSendBody - data passed to send method
 * @property {number} status - HTTP response status
 * @property {string} [originalResponseText] - Is not set if responseType is set
 *  to a value besides 'text'.
 * @property {string} [modifiedResponseText]
 */
export type XHRProxyConnectionDetails = {
  method: string;
  url: string;
  params: Record<string, string>;
  headers: Record<string, string>;
  responseType: string;
  originalSendBody: string | null | undefined;
};
export type XHRProxyConnectionDetailsWithResponse =
  XHRProxyConnectionDetails & {
    status: number;
    originalResponseText: string;
    modifiedResponseText: string;
  };
export type XHRProxyConnectionDetailsAfterListeners =
  XHRProxyConnectionDetails & {
    status: number;
    originalResponseText: string | null | undefined;
    modifiedResponseText: string | null | undefined;
  };

/**
 * Thing
 *
 * @callback XHRProxyWrapperCallback
 * @param {XHRProxyConnectionDetails} connection
 */
type Request = {
  method: string;
  url: string;
  body: string;
};

/**
 * Wrapper object contains optional callbacks that get run for completed
 * requests, and a required isRelevantTo method that filters what types of
 * requests the methods should be called for. All methods are passed an object
 * with details about the connection as the first argument. Some methods are
 * called with a relevant second argument (which is also present within the
 * connection argument).
 *
 * @typedef {Object} XHRProxyWrapper
 * @property {XHRProxyWrapperCallback} isRelevantTo - returns true if wrapper should be used
 *  for request.
 * @property {XHRProxyWrapperCallback} [originalSendBodyLogger] - called with value passed to
 *  send.
 * @property {XHRProxyWrapperCallback} [requestChanger] - Allows the protocol, URL, and body
 *  to be changed together before the connection is opened and sent.
 * @property {XHRProxyWrapperCallback} [originalResponseTextLogger] - called with the responseText as
 *  given by the server. Is not called if responseType is set to a value besides 'text'.
 * @property {XHRProxyWrapperCallback} [responseTextChanger] - called with the responseText as given
 *  by the server and returns new responseText value. Is not called if responseType
 * is set to a value besides 'text'.
 * @property {XHRProxyWrapperCallback} [finalResponseTextLogger] - called with the responseText as
 *  delivered to application code. Is not called if responseType is set to a value besides 'text'.
 * @property {XHRProxyWrapperCallback} [afterListeners] - called after all event listeners
 *  for readystatechange have run
 */
export type Wrapper = {
  isRelevantTo: (connection: XHRProxyConnectionDetails) => boolean;
  originalSendBodyLogger?: (
    connection: XHRProxyConnectionDetails,
    body: string,
  ) => void;
  requestChanger?: (
    connection: XHRProxyConnectionDetails,
    request: Record<string, any>,
  ) => Request | Promise<Request>;
  originalResponseTextLogger?: (
    connection: XHRProxyConnectionDetailsWithResponse,
    originalResponseText: string,
  ) => void;
  responseTextChanger?: (
    connection: XHRProxyConnectionDetailsWithResponse,
    originalResponseText: string,
  ) => string | Promise<string>;
  finalResponseTextLogger?: (
    connection: XHRProxyConnectionDetailsWithResponse,
    finalResponseText: string,
  ) => void;
  afterListeners?: (
    connection: XHRProxyConnectionDetailsAfterListeners,
  ) => void;
};
/**
 * Creates a drop-in replacement for the XMLHttpRequest constructor that can
 * have wrappers which may log or modify server responses. See
 * test/xhrproxy.js for usage examples and tests.
 * @function XHRProxyFactory
 * @param {function} XHR - original XMLHttpRequest constructor to wrap
 * @param {XHRProxyWrapper[]} wrappers - mutable array
 * @param {Object} [opts] - Can specify a logError function
 * @returns {function} wrapped XMLHttpRequest-like constructor
 */

export default function XHRProxyFactory(
  XHR: typeof XMLHttpRequest,
  wrappers: Wrapper[],
  opts: Opts,
): typeof XMLHttpRequest {
  const logError =
    (opts && opts.logError) ||
    function (error) {
      setTimeout(function () {
        // let window.onerror log this
        throw error;
      }, 1);
    };

  function transformEvent(
    oldTarget: unknown,
    newTarget: Record<string, any>,
    event: any,
  ) {
    const newEvent: any = {};
    Object.keys(event)
      .concat([
        'bubbles',
        'cancelBubble',
        'cancelable',
        'defaultPrevented',
        'preventDefault',
        'stopPropagation',
        'stopImmediatePropagation',
        'lengthComputable',
        'loaded',
        'total',
        'type',
        'currentTarget',
        'target',
        'srcElement',
        'NONE',
        'CAPTURING_PHASE',
        'AT_TARGET',
        'BUBBLING_PHASE',
        'eventPhase',
      ])
      .filter((name) => name in event)
      .forEach((name) => {
        const value = event[name];

        if (value === oldTarget) {
          newEvent[name] = newTarget;
        } else if (typeof value === 'function') {
          newEvent[name] = value.bind(event);
        } else {
          newEvent[name] = value;
        }
      });
    return newEvent;
  }

  function wrapEventListener(oldTarget: any, newTarget: any, listener: any) {
    return function (event: any) {
      return listener.call(
        newTarget,
        transformEvent(oldTarget, newTarget, event),
      );
    };
  }

  function findApplicableWrappers(
    wrappers: Wrapper[],
    connection: XHRProxyConnectionDetails,
  ) {
    return filter(wrappers, function (wrapper) {
      try {
        return wrapper.isRelevantTo(connection);
      } catch (e) {
        logError(e);
      }
    });
  }

  type XHRProxyThis = {
    _activeWrappers: any[];
    _boundListeners: Record<string, any>;
    _clientStartedSend: boolean;
    _connection: any;
    _events: unknown;
    _fakeRscEvent(): void;
    _listeners: unknown;
    _openState: unknown;
    _realStartedSend: unknown;
    _realxhr: XMLHttpRequest;
    _requestChangers: unknown[];
    _responseTextChangers: any[];
    _wrappers: Wrapper[];
    readyState: unknown;
    responseText: unknown;
    status: number;
    [key: `on${string}`]: any;
  };

  function XHRProxy(this: XHRProxyThis) {
    this._wrappers = wrappers;
    this._listeners = {};
    this._boundListeners = {};
    this._events = new EventEmitter(); // used for internal stuff, not user-visible events

    this.responseText = '';
    this._openState = false;

    if (XHR.bind && (XHR.bind.apply as any)) {
      // call constructor with variable number of arguments
      this._realxhr = new ((XHR as any).bind.apply(
        XHR,
        [null].concat(arguments as any),
      ))();
    } else {
      // Safari's XMLHttpRequest lacks a bind method, but its constructor
      // doesn't support extra arguments anyway, so don't bother logging an
      // error here.
      this._realxhr = new XHR();
    }

    const self = this;

    const triggerEventListeners = (name: string, event: unknown) => {
      if ((this as any)['on' + name]) {
        try {
          wrapEventListener(
            this._realxhr,
            this,
            (this as any)['on' + name],
          ).call(this, event);
        } catch (e) {
          logError(e, 'XMLHttpRequest event listener error');
        }
      }

      each(this._boundListeners[name], (boundListener) => {
        try {
          boundListener(event);
        } catch (e) {
          logError(e, 'XMLHttpRequest event listener error');
        }
      });
    };

    const runRscListeners = (event: unknown) => {
      triggerEventListeners('readystatechange', event);
    };

    this._fakeRscEvent = function () {
      runRscListeners(
        Object.freeze({
          bubbles: false,
          cancelBubble: false,
          cancelable: false,
          defaultPrevented: false,
          preventDefault: noop,
          stopPropagation: noop,
          stopImmediatePropagation: noop,
          type: 'readystatechange',
          currentTarget: this,
          target: this,
          srcElement: this,
          NONE: 0,
          CAPTURING_PHASE: 1,
          AT_TARGET: 2,
          BUBBLING_PHASE: 3,
          eventPhase: 0,
        }),
      );
    };

    const deliverFinalRsc = (event: unknown) => {
      this.readyState = 4;
      // Remember the status now before any event handlers are called, just in
      // case one aborts the request.
      var wasSuccess = this.status == 200;
      var progressEvent = Object.assign(
        {},
        transformEvent(this._realxhr, this, event),
        {
          lengthComputable: false,
          loaded: 0,
          total: 0,
        },
      );
      var supportsResponseText =
        !this._realxhr.responseType || this._realxhr.responseType == 'text';

      if (supportsResponseText) {
        each(this._activeWrappers, (wrapper) => {
          if (wrapper.finalResponseTextLogger) {
            try {
              wrapper.finalResponseTextLogger(
                this._connection,
                this.responseText,
              );
            } catch (e) {
              logError(e);
            }
          }
        });
      }

      runRscListeners(event);

      if (wasSuccess) {
        triggerEventListeners('load', progressEvent);
      } else {
        triggerEventListeners('error', progressEvent);
      }

      triggerEventListeners('loadend', progressEvent);
      each(this._activeWrappers, (wrapper) => {
        if (wrapper.afterListeners) {
          try {
            wrapper.afterListeners(this._connection);
          } catch (e) {
            logError(e);
          }
        }
      });
    };

    this._realxhr.addEventListener(
      'readystatechange',
      (event: Record<string, any>) => {
        if (!this._connection) {
          return;
        }

        if (this._realxhr.readyState >= 2) {
          this._connection.status = this._realxhr.status;
        }

        const supportsResponseText =
          !this._realxhr.responseType || this._realxhr.responseType == 'text';

        // Process the response text.
        if (this._realxhr.readyState == 4) {
          if (supportsResponseText) {
            Object.defineProperty(this._connection, 'originalResponseText', {
              enumerable: true,
              writable: false,
              configurable: false,
              value: self._realxhr.responseText,
            });
            each(this._activeWrappers, (wrapper) => {
              if (wrapper.originalResponseTextLogger) {
                try {
                  wrapper.originalResponseTextLogger(
                    this._connection,
                    this._connection.originalResponseText,
                  );
                } catch (e) {
                  logError(e);
                }
              }
            });
            const finish = once(deliverFinalRsc.bind(null, event));

            if (this._connection.async) {
              // If the XHR object is re-used for another connection, then we need
              // to make sure that our upcoming async calls here do nothing.
              // Remember the current connection object, and do nothing in our async
              // calls if it no longer matches.
              const startConnection = this._connection;
              (async () => {
                let modifiedResponseText: string =
                  startConnection.originalResponseText;
                startConnection.modifiedResponseText = modifiedResponseText;

                for (const responseTextChanger of this._responseTextChangers) {
                  const longRunWarningTimer = setTimeout(() => {
                    console.warn(
                      'responseTextChanger is taking too long',
                      responseTextChanger,
                      startConnection,
                    );
                  }, WARNING_TIMEOUT);

                  try {
                    modifiedResponseText = await responseTextChanger(
                      startConnection,
                      modifiedResponseText,
                    );
                  } finally {
                    clearTimeout(longRunWarningTimer);
                  }

                  if (typeof modifiedResponseText !== 'string') {
                    throw new Error(
                      'responseTextChanger returned non-string value ' +
                        modifiedResponseText,
                    );
                  }

                  startConnection.modifiedResponseText = modifiedResponseText;
                  if (startConnection !== this._connection) break;
                }

                return modifiedResponseText;
              })()
                .then(
                  (modifiedResponseText) => {
                    if (startConnection === self._connection) {
                      this.responseText = modifiedResponseText;
                      finish();
                    }
                  },
                  (err) => {
                    logError(err);

                    if (startConnection === this._connection) {
                      this.responseText = this._realxhr.responseText;
                      finish();
                    }
                  },
                )
                .catch(logError);
              return;
            } else {
              self.responseText = self._realxhr.responseText;
            }
          } else {
            self.responseText = '';
          }

          deliverFinalRsc(event);
        } else {
          if (self._realxhr.readyState == 1 && self.readyState == 1) {
            // Delayed open+send just happened. We already delivered an event
            // for this, so drop this event.
            return;
          } else if (self._realxhr.readyState >= 3 && supportsResponseText) {
            if (self._responseTextChangers.length) {
              // If we're going to transform the final response, then we don't
              // want to expose any partial untransformed responses and we don't
              // want to bother trying to transform partial responses. Only show
              // an empty string as the loaded response until the connection is
              // done.
              self.responseText = '';
            } else {
              self.responseText = self._realxhr.responseText;
            }
          } else {
            self.responseText = '';
          }

          self.readyState = self._realxhr.readyState;
          runRscListeners(event);
        }
      },
      false,
    );

    [
      'dispatchEvent',
      'getAllResponseHeaders',
      'getResponseHeader',
      'overrideMimeType',
      'responseType',
      'responseXML',
      'responseURL',
      'status',
      'statusText',
      'timeout',
      'ontimeout',
      'onloadstart',
      'onprogress',
      'onabort',
      'upload',
      'withCredentials',
    ].forEach(function (prop) {
      Object.defineProperty(self, prop, {
        enumerable: true,
        configurable: false,
        get: function () {
          // If we give the original native methods directly, they'll be called
          // with `this` as the XHRProxy object, which they aren't made for.
          if (typeof (self._realxhr as any)[prop] == 'function') {
            return (self._realxhr as any)[prop].bind(self._realxhr);
          }

          return (self._realxhr as any)[prop];
        },
        set: function (v) {
          if (typeof v == 'function') {
            v = wrapEventListener(this._realxhr, this, v);
          }

          (self._realxhr as any)[prop] = v;
        },
      });
    });
    (Object as any).defineProperty(self, 'response', {
      enumerable: true,
      configurable: false,
      get: function () {
        if (
          !this._realxhr.responseType ||
          this._realxhr.responseType == 'text'
        ) {
          return this.responseText;
        } else {
          // We're not trying to transform non-text responses currently.
          return this._realxhr.response;
        }
      },
    });
    self.readyState = self._realxhr.readyState;
  }

  XHRProxy.prototype.abort = function () {
    // Important: If the request has already been sent, the XHR will change
    // its readyState to 4 after abort. However, we sometimes asynchronously
    // delay send calls. If the application has already called send but we
    // haven't sent off the real call yet, then we need to hurry up and send
    // something before the abort so that the readyState change happens.
    if (this._clientStartedSend && !this._realStartedSend) {
      if (this.readyState != 0 && this._realxhr.readyState == 0) {
        this._realxhr.open(this._connection.method, this._connection.url);
      }

      this._realStartedSend = true;

      this._realxhr.send();
    }

    this._realxhr.abort();
  };

  XHRProxy.prototype.setRequestHeader = function (
    name: string,
    value: unknown,
  ) {
    var self = this;

    if (this.readyState != 1) {
      console.warn(
        'setRequestHeader improperly called at readyState ' + this.readyState,
      );
    }

    if (!this._openState) {
      throw new Error('Can only set headers after open and before send');
    }

    this._connection.headers[name] = value;

    if (this._connection.async && this._requestChangers.length) {
      this._events.once('realOpen', function () {
        self._realxhr.setRequestHeader(name, value);
      });
    } else {
      this._realxhr.setRequestHeader(name, value);
    }
  };

  XHRProxy.prototype.addEventListener = function (
    name: string,
    listener: unknown,
  ) {
    if (!this._listeners[name]) {
      this._listeners[name] = [];
      this._boundListeners[name] = [];
    }

    if (!includes(this._listeners[name], listener)) {
      var boundListener = wrapEventListener(this._realxhr, this, listener);

      this._listeners[name].push(listener);

      this._boundListeners[name].push(boundListener);

      if (!includes(['readystatechange', 'load', 'error', 'loadend'], name)) {
        // certain listeners are called manually so that the final
        // call (when readyState==4) can be delayed.
        this._realxhr.addEventListener(name, boundListener, false);
      }
    }
  };

  XHRProxy.prototype.removeEventListener = function (
    name: string,
    listener: unknown,
  ) {
    if (!this._listeners[name]) {
      return;
    }

    var i = this._listeners[name].indexOf(listener);

    if (i == -1) {
      return;
    }

    this._listeners[name].splice(i, 1);

    var boundListener = this._boundListeners[name].splice(i, 1)[0];

    if (name != 'readystatechange') {
      this._realxhr.removeEventListener(name, boundListener, false);
    }
  };

  XHRProxy.prototype.open = function (
    this: XHRProxyThis,
    method: string,
    url: string,
    async: boolean,
  ) {
    // Work around MailTrack issue
    if (!(this instanceof XHRProxy)) {
      return XHR.prototype.open.apply(this, arguments as any);
    }

    var self = this;
    this._connection = {
      method: method,
      url: url,
      params: deparam(url.split('?')[1] || ''),
      headers: {},
      async: arguments.length < 3 || !!async,
    };
    this._clientStartedSend = false;
    this._realStartedSend = false;
    this._activeWrappers = findApplicableWrappers(
      this._wrappers,
      this._connection,
    );
    this._responseTextChangers = this._activeWrappers
      .map((wrapper) => {
        return (
          wrapper.responseTextChanger &&
          wrapper.responseTextChanger.bind(wrapper)
        );
      })
      .filter(isNotNil);
    this.responseText = '';
    this._openState = true;

    function finish(method: string, url: string) {
      return self._realxhr.open(method, url, self._connection.async);
    }

    if (this._connection.async) {
      this._requestChangers = this._activeWrappers
        .map((wrapper) => {
          return wrapper.requestChanger && wrapper.requestChanger.bind(wrapper);
        })
        .filter(isNotNil);

      if (this._requestChangers.length) {
        if (this.readyState != 1) {
          this.readyState = 1;

          this._fakeRscEvent();
        }
      } else {
        finish(method, url);
      }
    } else {
      finish(method, url);
    }
  };

  XHRProxy.prototype.send = function (body: unknown) {
    var self = this;
    this._clientStartedSend = true;
    this._openState = false;
    Object.defineProperty(this._connection, 'originalSendBody', {
      enumerable: true,
      writable: false,
      configurable: false,
      value: body,
    });
    this._connection.responseType = this._realxhr.responseType || 'text';
    each(self._activeWrappers, function (wrapper) {
      if (wrapper.originalSendBodyLogger) {
        try {
          wrapper.originalSendBodyLogger(self._connection, body);
        } catch (e) {
          logError(e);
        }
      }
    });

    function finish(body: unknown) {
      self._realStartedSend = true;

      self._realxhr.send(body);
    }

    if (this._connection.async && this._requestChangers.length) {
      // If the XHR object is re-used for another connection, then we need
      // to make sure that our upcoming async calls here do nothing.
      // Remember the current connection object, and do nothing in our async
      // calls if it no longer matches. Also check for aborts.
      const startConnection = this._connection;
      const request = {
        method: this._connection.method,
        url: this._connection.url,
        body: body,
      };
      (async () => {
        let modifiedRequest = request;
        for (const requestChanger of this._requestChangers) {
          const longRunWarningTimer = setTimeout(() => {
            console.warn(
              'requestChanger is taking too long',
              requestChanger,
              startConnection,
            );
          }, WARNING_TIMEOUT);

          try {
            modifiedRequest = await requestChanger(
              this._connection,
              Object.freeze(modifiedRequest),
            );
          } finally {
            clearTimeout(longRunWarningTimer);
          }

          assert(has(modifiedRequest, 'method'), 'modifiedRequest has method');
          assert(has(modifiedRequest, 'url'), 'modifiedRequest has url');
          assert(has(modifiedRequest, 'body'), 'modifiedRequest has body');
          if (startConnection !== this._connection || this._realStartedSend)
            break;
        }

        return modifiedRequest;
      })()
        .catch((err) => {
          logError(err);
          return request;
        })
        .then((modifiedRequest) => {
          if (startConnection === this._connection && !this._realStartedSend) {
            this._realxhr.open(modifiedRequest.method, modifiedRequest.url);

            this._events.emit('realOpen');

            finish(modifiedRequest.body);
          }
        });
    } else {
      finish(body);
    }
  };

  [XHRProxy, XHRProxy.prototype].forEach(function (obj) {
    Object.assign(obj, {
      UNSENT: 0,
      OPENED: 1,
      HEADERS_RECEIVED: 2,
      LOADING: 3,
      DONE: 4,
    });
  });
  return XHRProxy as any;
}
