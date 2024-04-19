import * as ud from 'ud';
import * as Kefir from 'kefir';
import get from '../../common/get-or-fail';
import ComposeView from '../views/compose-view';
import HandlerRegistry from '../lib/handler-registry';
import type Membrane from '../lib/Membrane';
import type { Handler } from '../lib/handler-registry';
import type { Driver } from '../driver-interfaces/driver';
interface Members {
  driver: Driver;
  membrane: Membrane;
  handlerRegistry: HandlerRegistry<ComposeView>;
  composeViewStream: Kefir.Observable<ComposeView, unknown>;
}
const memberMap = ud.defonce(module, () => new WeakMap<Compose, Members>());
const SAMPLE_RATE = 0.01;

export default class Compose {
  constructor(driver: Driver, membrane: Membrane) {
    const members = {
      driver,
      membrane,
      handlerRegistry: new HandlerRegistry<ComposeView>(),
      composeViewStream: driver
        .getComposeViewDriverStream()
        .map((viewDriver) => membrane.get(viewDriver) as ComposeView),
    };
    memberMap.set(this, members);
    driver.getStopper().onValue(() => {
      members.handlerRegistry.dumpHandlers();
    });
    members.composeViewStream.onValue((view) => {
      driver.getLogger().trackFunctionPerformance(
        () => {
          members.handlerRegistry.addTarget(view);
        },
        SAMPLE_RATE,
        {
          type: 'composeViewHandler',
          isInlineReplyForm: view.isInlineReplyForm(),
        },
      );
    });
  }

  registerComposeViewHandler(handler: Handler<ComposeView>) {
    return get(memberMap, this).handlerRegistry.registerHandler(handler);
  }

  async openNewComposeView(): Promise<ComposeView> {
    const members = get(memberMap, this);
    const composeViewDriver = await members.driver.openNewComposeViewDriver();
    return members.membrane.get(composeViewDriver);
  }

  async openDraftByMessageID(messageID: string): Promise<ComposeView> {
    const members = get(memberMap, this);
    const newComposePromise = members.composeViewStream.take(1).toPromise();
    await members.driver.openDraftByMessageID(messageID);
    return Kefir.fromPromise(newComposePromise)
      .merge(
        Kefir.later(15 * 1000, null).flatMap(() =>
          Kefir.constantError(new Error('draft did not open in time')),
        ),
      )
      .take(1)
      .takeErrors(1)
      .toPromise();
  }

  /** @deprecated Use {@link openNewComposeView} instead */
  getComposeView(): Promise<ComposeView> {
    const { driver } = get(memberMap, this);
    driver
      .getLogger()
      .deprecationWarning(
        'Compose.getComposeView',
        'Compose.openNewComposeView',
      );

    if (driver.getOpts().REQUESTED_API_VERSION !== 1) {
      throw new Error('This method was discontinued after API version 1');
    }

    return this.openNewComposeView();
  }
}
