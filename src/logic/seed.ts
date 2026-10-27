import type { Affirmation, BucketId, FitnessType, Indulgence, PrepKind, TemplateTask } from '../types';
import { newId } from './ids';

const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [6, 0];
const SAT = [6];
const SUN = [0];
const TEN_PM = 22 * 60;

type SeedTask = [name: string, days: number[], bucket: BucketId, deadlineOverride?: number];

const STARTING_TEMPLATE: SeedTask[] = [
  // Weekdays
  ['Up at 5:30', WEEKDAYS, 'morning'],
  ['Shoulder PT', [1, 3, 5], 'morning'],
  ['CrossFit', [2, 4], 'morning'],
  ['Shower', WEEKDAYS, 'morning'],
  ['Breakfast + BP meds', WEEKDAYS, 'morning'],
  ['Brush teeth', WEEKDAYS, 'morning'],
  ['Focus work block', WEEKDAYS, 'afternoon'],
  ['Lunch smoothie', WEEKDAYS, 'afternoon'],
  ['Dog walk', WEEKDAYS, 'afternoon'],
  ['Workday done', WEEKDAYS, 'afternoon'],
  ['Feed the dog', WEEKDAYS, 'evening'],
  ['Dinner (prepped meal)', WEEKDAYS, 'evening'],
  ['Brush teeth + wind down', WEEKDAYS, 'evening', TEN_PM],
  // Weekend, 1st half
  ['Up at 5:30', WEEKEND, 'half1'],
  ['Breakfast + BP meds', WEEKEND, 'half1'],
  ['Brush teeth', WEEKEND, 'half1'],
  ['Meijer run', SAT, 'half1'],
  ['Prep chicken', SAT, 'half1'],
  ['Shower', WEEKEND, 'half1'],
  ['Lunch smoothie', WEEKEND, 'half1'],
  ['Dog walk', WEEKEND, 'half1'],
  // Weekend, 2nd half
  ['Meal prep (quinoa + chicken, pack 6 meals)', SUN, 'half2'],
  ['Laundry: wash + dry', SUN, 'half2'],
  ['Fold + put away laundry', SUN, 'half2'],
  ['Feed the dog', WEEKEND, 'half2'],
  ['Dinner (order out)', SAT, 'half2'],
  ['Dinner (prepped meal)', SUN, 'half2'],
  ['Brush teeth + wind down', WEEKEND, 'half2', TEN_PM],
];

/** Template tasks that count toward the Frontier Expedition, by name (case-insensitive). */
export const FITNESS_TAGS: Record<string, FitnessType> = {
  crossfit: 'crossfit',
  'shoulder pt': 'pt',
  'dog walk': 'activity',
};

export function fitnessTagFor(name: string): FitnessType | null {
  return FITNESS_TAGS[name.trim().toLowerCase()] ?? null;
}

/** Meals for Contingency Provisions: breakfast, lunch and dinner, planned treats included. */
export function mealTagFor(name: string): boolean {
  return /^(breakfast|lunch|dinner)\b/i.test(name.trim());
}

/** Prep steps: the grocery run is shopping and the Sunday meal prep is cooking. */
export function prepTagFor(name: string): PrepKind | null {
  const n = name.trim().toLowerCase();
  if (n === 'meijer run') return 'shopping';
  if (/^meal prep\b/.test(n)) return 'cooking';
  return null;
}

export function startingTemplate(): TemplateTask[] {
  return STARTING_TEMPLATE.map(([name, days, bucket, deadlineOverride], i) => ({
    id: newId(),
    name,
    days: [...days].sort(),
    bucket,
    deadlineOverride: deadlineOverride ?? null,
    weight: 1,
    order: i,
    fitness: fitnessTagFor(name),
    meal: mealTagFor(name),
    prep: prepTagFor(name),
  }));
}

const STARTING_AFFIRMATIONS = [
  'You started. That was the hard part, and you already did it.',
  'Small finished things add up to a finished life.',
  'You have kept promises to yourself before. Keep this one too.',
  'Done is a skill, and you are practicing it right now.',
  'You don’t need to feel ready. You just need the next step.',
  'Momentum is built, not found. You are building it.',
  'You can do hard things slowly. Slow still gets there.',
  'Every checked box is proof, not luck.',
  'The version of you who finishes things is not someone else. It’s you.',
  'You showed up today. That counts for more than you think.',
  'Finishing beats perfecting. Ship it and move on.',
  'You are allowed to be proud of ordinary days.',
  'Your future self is already grateful for this.',
  'One task at a time is still a plan.',
  'A bad hour doesn’t get to decide the whole day.',
  'You don’t have to win the week. Just win the next block.',
  'Consistency is quiet. Keep being quietly consistent.',
  'You’re better at following through than your doubts say.',
  'Rest is part of the routine, not a break from it.',
  'You can restart at any minute. Now is a fine minute.',
  'Discipline is just remembering what you want.',
  'You are the kind of person who comes back to it.',
  'Most of the work is starting again. You keep starting again.',
  'You have handled every day so far. Today is no different.',
  'Progress you can’t see yet is still progress.',
  'The routine holds you up on the days you can’t hold yourself.',
  'Finish the small thing. Then decide about the big thing.',
  'You don’t need motivation to do the next five minutes.',
  'A late finish is still a finish.',
  'You are steadier than you were a month ago.',
  'Your word to yourself is worth keeping.',
  'Taking care of your body is taking care of everything else.',
  'You are allowed to make it easy on yourself and still do it.',
  'The streak doesn’t matter as much as the return.',
  'Look how much of today you already handled.',
  'You were built for long games.',
  'Good enough and finished beats perfect and pending.',
  'You’ve done this exact thing before. Do it once more.',
  'Steady hands, clear head, next task.',
  'You finish what you start. Prove it again today.',
];

export function startingAffirmations(now: string): Affirmation[] {
  return STARTING_AFFIRMATIONS.map((text, i) => ({
    id: newId(),
    text,
    removed: false,
    order: i,
    createdAt: now,
  }));
}

const EXAMPLE_NOTE = 'Example — edit or retire me.';

const STARTING_INDULGENCES: [string, 4 | 5, string][] = [
  ['Fancy coffee out', 4, '☕'],
  ['An hour of guilt-free gaming', 4, '🎮'],
  ['A new book or comic', 4, '📚'],
  ['Takeout from a favorite spot', 5, '🍜'],
  ['Wishlist item (up to $50)', 5, '🎁'],
  ['Movie night out', 5, '🎬'],
];

export function startingIndulgences(now: string): Indulgence[] {
  return STARTING_INDULGENCES.map(([name, rarity, emoji], i) => ({
    id: newId(),
    name,
    rarity,
    emoji,
    note: EXAMPLE_NOTE,
    active: true,
    order: i,
    createdAt: now,
  }));
}
