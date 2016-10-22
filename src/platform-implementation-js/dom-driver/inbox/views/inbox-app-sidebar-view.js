/* @flow */

import _ from 'lodash';
import {defn} from 'ud';
import autoHtml from 'auto-html';
import Kefir from 'kefir';
import kefirStopper from 'kefir-stopper';
import fakeWindowResize from '../../../lib/fake-window-resize';
import findParent from '../../../lib/dom/find-parent';
import getChatSidebarClassname from '../getChatSidebarClassname';
import delayAsap from '../../../lib/delay-asap';
import waitForAnimationClickBlockerGone from '../waitForAnimationClickBlockerGone';
import makeMutationObserverChunkedStream from '../../../lib/dom/make-mutation-observer-chunked-stream';
import fromEventTargetCapture from '../../../lib/from-event-target-capture';
import appSidebarIcon from '../../../lib/appSidebarIcon';
import idMap from '../../../lib/idMap';

import type InboxDriver from '../inbox-driver';
import InboxSidebarContentPanelView from './inbox-sidebar-content-panel-view';

class InboxAppSidebarView {
  _stopper = kefirStopper();
  _driver: InboxDriver;
  _el: HTMLElement;
  _contentArea: HTMLElement;
  _mainParent: HTMLElement;
  _openOrOpeningProp: Kefir.Observable<boolean>;

  constructor(driver: InboxDriver) {
    this._driver = driver;

    // We need to be able to cooperate with other apps/extensions that are
    // sharing the app sidebar. We store some properties as attributes in the
    // shared DOM instead of as class properties; class properties are mostly
    // restricted to being used for references to DOM nodes. When
    // InboxAppSidebarView is instantiated, we check to see if the element
    // already exists and create it if it doesn't.
    const el = document.querySelector('.'+idMap('app_sidebar'));
    if (el) {
      this._el = el;
    } else {
      this._createElement();
    }
    this._contentArea = this._el.querySelector('.'+idMap('sidebar_panel_content_area'));

    const mainParent = findParent(document.querySelector('[role=application]'), el => el.parentElement === document.body);
    if (!mainParent) {
      const err = new Error('Failed to find main parent');
      this._driver.getLogger().errorSite(err);
      throw err;
    }
    this._mainParent = mainParent;

    this._openOrOpeningProp = makeMutationObserverChunkedStream(
      this._el, {attributes: true, attributeFilter: ['data-open', 'data-is-opening']}
    )
      .toProperty(() => null)
      .map(() =>
        this._el.getAttribute('data-open') === 'true' ||
        this._el.getAttribute('data-is-opening') === 'true'
      )
      .skipDuplicates();
  }

  destroy() {
    this._stopper.destroy();
    this._el.remove();
  }

  open() {
    this._setShouldAppSidebarOpen(true);
    this._setOpenedNow(true);
  }

  close() {
    this._setShouldAppSidebarOpen(false);
    this._setOpenedNow(false);
  }

  getOpenOrOpeningStream(): Kefir.Observable<boolean> {
    return this._openOrOpeningProp;
  }

  // This value controls whether the app sidebar should automatically open
  // itself when available when the chat sidebar isn't present. It's only set
  // if the user interacts with the app sidebar button.
  _getShouldAppSidebarOpen(): boolean {
    return localStorage.getItem('inboxsdk__app_sidebar_should_open') === 'true';
  }

  _setShouldAppSidebarOpen(open: boolean) {
    try {
      localStorage.setItem('inboxsdk__app_sidebar_should_open', String(open));
    } catch(err) {
      console.error('error saving', err);
    }
  }

  _createElement() {
    const el = this._el = document.createElement('div');
    el.className = idMap('app_sidebar');
    el.innerHTML = `
      <div class="${idMap('app_sidebar_main')}">
        <div class="${idMap('sidebar_panel_content_area')}"></div>
      </div>
      <button class="inboxsdk__close_button" type="button" title="Close"></button>
    `;
    // Store the open state in the DOM rather than a class property because
    // multiple instances of InboxAppSidebarView from different apps need to
    // share the value.
    el.setAttribute('data-open', 'false');
    el.setAttribute('data-can-open', 'false');
    el.setAttribute('data-is-opening', 'false');
    document.body.appendChild(el);

    const contentArea = el.querySelector('.'+idMap('sidebar_panel_content_area'));

    // If the user clicks the chat button while the chat sidebar and app
    // sidebar are both open, then we want the chat sidebar to become visible.
    // We block Inbox from closing the chat sidebar, and we close the app sidebar.
    fromEventTargetCapture(this._driver.getChatSidebarButton(), 'click')
      .filter(() =>
        el.getAttribute('data-open') === 'true' &&
        this._driver.getCurrentChatSidebarView().getMode() === 'SIDEBAR'
      )
      .takeUntilBy(this._stopper)
      .onValue(event => {
        event.stopImmediatePropagation();
        this._setShouldAppSidebarOpen(false);
        this._setOpenedNow(false);
      });

    this._driver.getCurrentChatSidebarView().getModeStream()
      .changes()
      .takeUntilBy(this._stopper)
      .onValue(mode => {
        if (mode === 'SIDEBAR') {
          // If the user clicks the chat button while the chat sidebar is
          // closed and the app sidebar is open, and Inbox opens the chat
          // sidebar, then we want the chat sidebar to become visible. We just
          // hide the app sidebar after Inbox brings up the chat sidebar.
          this._setShouldAppSidebarOpen(false);
          this._setOpenedNow(false);
        } else {
          // If the chat sidebar changes in any other way
          // (ie. HIDDEN<->DROPDOWN) while the app sidebar is open, then we
          // might need to fix up some class changes that Inbox might have
          // made.
          if (el.getAttribute('data-open') === 'true') {
            this._setOpenedNow(true);
          }
        }
      });

    el.querySelector(`.inboxsdk__close_button`).addEventListener('click', () => {
      this._setShouldAppSidebarOpen(false);
      this._setOpenedNow(false);
    });
  }

  _setOpenedNow(open: boolean) {
    this._el.setAttribute('data-open', String(open));
    this._el.setAttribute('data-can-open', String(this._contentArea.childElementCount>0));
    if (!open) {
      if (
        this._driver.getCurrentChatSidebarView().getMode() !== 'SIDEBAR' &&
        this._mainParent.classList.contains(getChatSidebarClassname())
      ) {
        this._mainParent.classList.remove(getChatSidebarClassname());
        this._driver.getPageCommunicator().fakeWindowResize();
      }
    } else {
      if (
        this._driver.getCurrentChatSidebarView().getMode() !== 'SIDEBAR' &&
        !this._mainParent.classList.contains(getChatSidebarClassname())
      ) {
        this._mainParent.classList.add(getChatSidebarClassname());
        this._driver.getPageCommunicator().fakeWindowResize();
      }
    }
  }

  _setOpenedAfterAnimation(open: boolean) {
    this._el.setAttribute('data-is-opening', 'true');
    waitForAnimationClickBlockerGone()
      .takeUntilBy(this._stopper)
      .takeUntilBy(makeMutationObserverChunkedStream(
        this._el, {attributes: true, attributeFilter: ['data-open']}
      ))
      .onValue(() => {
        this._setOpenedNow(open);
      })
      .onEnd(() => {
        this._el.setAttribute('data-is-opening', 'false');
      });
  }

  addSidebarContentPanel(descriptor: Kefir.Observable<Object>) {
    const view = new InboxSidebarContentPanelView(descriptor);

    this._contentArea.appendChild(view.getElement());

    if (
      this._driver.getCurrentChatSidebarView().getMode() === 'SIDEBAR' ||
      this._getShouldAppSidebarOpen()
    ) {
      this._setOpenedAfterAnimation(true);
    } else {
      this._el.setAttribute('data-can-open', 'true');
    }

    this._stopper
      .takeUntilBy(view.getStopper())
      .onValue(() => {
        view.remove();
      });

    view.getStopper()
      .delay(0)
      .onValue(() => {
        // The delay(0) is necessary because the view's element isn't removed
        // already at the time the stopper fires, and because we don't really
        // need to close the sidebar synchronously.
        const hasChildren = this._contentArea.childElementCount > 0;
        this._el.setAttribute('data-can-open', String(hasChildren));
        if (!hasChildren) {
          this._setOpenedNow(false);
        }
      });
    return view;
  }
}

export default defn(module, InboxAppSidebarView);