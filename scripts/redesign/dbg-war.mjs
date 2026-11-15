import { loadTestContent, makeParty } from "../../packages/engine/test/helpers.ts";
import { buildHeroCombatant, buildMonsterCombatant, simulateEncounter } from "../../packages/engine/src/combat.ts";
import { Rng } from "../../packages/engine/src/rng.ts";
const content = loadTestContent();
const party = makeParty(content, 3);
const heroes = party.map((spec) => buildHeroCombatant(content, spec));
for (const h of heroes) { h.maxEnergy = 100; h.energy = 100; h.maxHp = 999; h.hp = 999; }
console.log("hero skills:", heroes.map(h => h.name + ":" + h.skills.map(s=>s.id).join(",")));
const monster = buildMonsterCombatant(content, content.monsters.find(r => r.id === "mine-bat"), "bat", "front");
monster.maxHp = 999; monster.hp = 999;
const result = simulateEncounter(heroes, [monster], new Rng(77), { name: "t", maxRounds: 1 });
console.log(result.log.filter(e=>e.actionName).map(e=>`${e.actor?.name}:${e.actionName}:${e.phase}:${e.effect?.type??"-"}`).join("\n"));
