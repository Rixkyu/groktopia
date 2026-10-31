import { GameEngine } from './engine/GameEngine';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui-root') as HTMLElement;

const engine = new GameEngine(canvas, uiRoot);
engine.start();

// Expose for debugging/inspection if needed
(window as unknown as { __groktopia?: GameEngine }).__groktopia = engine;
