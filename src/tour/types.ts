/* The shape of a guided tour. Pure data: tests/tours.test.ts reads it without a
 * browser, and every name in it must exist somewhere in src as data-tour="…". */

/** 'side' = left or right of the target, whichever has room. */
export type TourPlacement = 'auto' | 'top' | 'bottom' | 'side';

export interface TourStep {
  /** Unique inside its tour. */
  id: string;
  /** data-tour name of the thing this step lights. None = a card in the middle
   *  of the screen (a welcome, a summary of the process). */
  target?: string;
  title: string;
  /** Plain Hebrew. A blank line starts a new paragraph. */
  body: string;
  /** THE PHOTOGRAPHER DOES IT. The step lights `target`, lets clicks through to
   *  it (and only to it), and moves on by itself the moment an element named
   *  `waitFor` appears — the dialog opened, the screen changed. There is no
   *  "next" button on such a step: the click is the next button. */
  waitFor?: string;
  /** The one line that says what to do, shown with a pointer on action steps. */
  doText?: string;
  /** A SITUATION, not a fixture: shown only when its target is on screen
   *  (a failed import, a twin suggestion), skipped silently otherwise. */
  optional?: boolean;
  placement?: TourPlacement;
}

export interface Tour {
  id: string;
  /** Which screen's "?" button replays it, and where it starts by itself on a
   *  first visit. */
  screen: string;
  /** Shown above every step: which tour this is. */
  title: string;
  /** A tour for something that OPENS — a viewer, a panel — rather than for a
   *  screen. It plays by itself the first time an element with this data-tour
   *  name appears, and ends by itself when that element goes away. */
  trigger?: string;
  steps: TourStep[];
}
