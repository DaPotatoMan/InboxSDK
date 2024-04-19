import * as Kefir from 'kefir';
import udKefir from 'ud-kefir';

import kefirMakeMutationObserverChunkedStream from '../../../lib/dom/make-mutation-observer-chunked-stream';
import makeElementChildStream, {
  ElementWithLifetime,
} from '../../../lib/dom/make-element-child-stream';
import elementViewMapper from '../../../lib/dom/element-view-mapper';
import makeElementStreamMerger from '../../../lib/dom/make-element-stream-merger';
import GmailElementGetter from '../gmail-element-getter';
import GmailComposeView from '../views/gmail-compose-view';
import type GmailMessageView from '../views/gmail-message-view';
import type GmailDriver from '../gmail-driver';
import isNotNil from '../../../../common/isNotNil';

var impStream = udKefir(module, imp);

export default function setupComposeViewDriverStream(
  gmailDriver: GmailDriver,
  messageViewDriverStream: Kefir.Observable<GmailMessageView, unknown>,
  xhrInterceptorStream: Kefir.Observable<any, unknown>,
): Kefir.Observable<GmailComposeView, unknown> {
  return impStream.flatMapLatest((imp) =>
    imp(gmailDriver, messageViewDriverStream, xhrInterceptorStream),
  );
}

function imp(
  gmailDriver: GmailDriver,
  messageViewDriverStream: Kefir.Observable<GmailMessageView, unknown>,
  xhrInterceptorStream: Kefir.Observable<any, unknown>,
): Kefir.Observable<GmailComposeView, unknown> {
  return Kefir.fromPromise(GmailElementGetter.waitForGmailModeToSettle())
    .flatMap(() => {
      let elementStream: Kefir.Observable<ElementWithLifetime, never>;
      let isStandalone = false;

      if (GmailElementGetter.isStandaloneComposeWindow()) {
        elementStream = _setupStandaloneComposeElementStream();
        isStandalone = true;
      } else if (GmailElementGetter.isStandaloneThreadWindow()) {
        elementStream = Kefir.never();
      } else {
        elementStream = _setupStandardComposeElementStream();
      }

      return elementStream.map(
        elementViewMapper(
          (el) =>
            new GmailComposeView(el, xhrInterceptorStream, gmailDriver, {
              isStandalone,
              isInlineReplyForm: false,
            }),
        ),
      );
    })
    .merge(
      messageViewDriverStream.flatMap((gmailMessageView) =>
        gmailMessageView.getReplyElementStream().map(
          elementViewMapper(
            (el) =>
              new GmailComposeView(el, xhrInterceptorStream, gmailDriver, {
                isStandalone: false,
                isInlineReplyForm: true,
              }),
          ),
        ),
      ),
    )
    .flatMap((composeViewDriver) => composeViewDriver.ready());
}

function _setupStandardComposeElementStream() {
  return _waitForContainerAndMonitorChildrenStream(() =>
    GmailElementGetter.getComposeWindowContainer(),
  )
    .flatMap((composeGrandParent) => {
      const composeParentEl =
        composeGrandParent.el.querySelector<HTMLElement>('div.AD');
      if (composeParentEl) {
        return makeElementChildStream(composeParentEl)
          .takeUntilBy(composeGrandParent.removalStream)
          .map(_informElement('composeFullscreenStateChanged'));
      } else {
        return Kefir.never();
      }
    })
    .merge(
      GmailElementGetter.getFullscreenComposeWindowContainerStream()
        .flatMap(({ el, removalStream }) =>
          makeElementChildStream(el).takeUntilBy(removalStream),
        )
        .map(_informElement('composeFullscreenStateChanged'))
        .map(({ el, removalStream }) => {
          // If you close a fullscreen compose while it's still saving, Gmail never
          // removes it from the DOM, and instead only removes a specific child
          // element. Ugh. Watch for its removal too.
          const targetEl = el.querySelector<HTMLElement>(
            '[role=dialog] div.aaZ',
          );
          if (!targetEl) return null;
          var hiddenStream = kefirMakeMutationObserverChunkedStream(targetEl, {
            childList: true,
          })
            .filter(() => targetEl.childElementCount === 0)
            .map(() => null);
          return {
            el,
            removalStream: removalStream.merge(hiddenStream).take(1),
          };
        })
        .filter(isNotNil),
    )
    .flatMap((event) => {
      if (!event) throw new Error('Should not happen');
      const el = event.el.querySelector<HTMLElement>('[role=dialog]');
      if (!el || !el.querySelector('form')) {
        return Kefir.never();
      }
      return Kefir.constant({
        el,
        removalStream: event.removalStream,
      });
    })
    .flatMap(makeElementStreamMerger());
}

function _setupStandaloneComposeElementStream(): Kefir.Observable<
  ElementWithLifetime,
  never
> {
  return _waitForContainerAndMonitorChildrenStream(() =>
    GmailElementGetter.StandaloneCompose.getComposeWindowContainer(),
  );
}

function _waitForContainerAndMonitorChildrenStream(
  containerFn: () => HTMLElement | undefined | null,
) {
  return Kefir.interval(2000, undefined) // TODO replace this with page-parser-tree
    .map(containerFn)
    .filter()
    .take(1)
    .flatMap((containerEl) => makeElementChildStream(containerEl!));
}

function _informElement(eventName: string) {
  return function <T extends { readonly el?: HTMLElement }>(event: T): T {
    const composeEl =
      event &&
      event.el &&
      event.el.querySelector &&
      event.el.querySelector('[role=dialog]');
    if (composeEl) {
      composeEl.dispatchEvent(
        new CustomEvent(eventName, {
          bubbles: false,
          cancelable: false,
          detail: null,
        }),
      );
    }
    return event;
  };
}
