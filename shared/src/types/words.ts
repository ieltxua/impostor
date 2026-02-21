import type { WordPair } from './room.js';

export interface WordDeckEntry extends WordPair {
  category: string;
}

export const DEFAULT_WORD_DECK: WordDeckEntry[] = [
  { category: 'Food', a: 'Pizza', b: 'Empanada' },
  { category: 'Places', a: 'Beach', b: 'Desert' },
  { category: 'Sports', a: 'Soccer', b: 'Basketball' },
  { category: 'Animals', a: 'Tiger', b: 'Lion' },
  { category: 'Tech', a: 'Laptop', b: 'Tablet' }
];
