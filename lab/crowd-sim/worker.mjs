// Self-play / arena oyunlarını ayrı iş parçacığında oynatır (cli.mjs çağırır).
import { parentPort, workerData } from 'node:worker_threads';
import { Net } from './nn.js';
import { playGame } from './alphazero.js';

const { netJSON, seeds, pool, nAgents, sims, explore } = workerData;
const net = Net.fromJSON(netJSON);
const results = seeds.map((seed) => {
  const g = playGame(net, { seed, pool, nAgents, sims, explore });
  return explore ? g : { ...g, examples: [] };   // arena oyunlarında örnek taşımaya gerek yok
});
parentPort.postMessage(results);
