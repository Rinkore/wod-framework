import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Always create an isolated database before loading any server module.
const childMode = process.argv[2] === "--check-persisted";
const temporary = childMode ? null : mkdtempSync(path.join(tmpdir(), "wod-death-draft-"));
if (temporary) {
  process.env.WOD_DB = path.join(temporary, "regression.db");
  process.env.WOD_DATA_DIR = temporary;
}
if (!process.env.WOD_DB || !process.env.WOD_DATA_DIR) throw new Error("Missing isolated database");
const { db } = await import("../apps/server/src/db.js");
const heroes = await import("../apps/server/src/services/heroes.js");
const death = await import("../apps/server/src/services/death.js");
const { content } = await import("../apps/server/src/content.js");
const { MAX_HEROES_PER_ACCOUNT, WEAPON_TYPES } = await import("@wod/shared");

type RecordRow = Record<string, string | number | null>;
function one(sql: string, ...params: (string | number)[]): RecordRow {
  return db.prepare(sql).get(...params) as RecordRow;
}
function count(table: string, userId: string): number {
  return Number(one(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`, userId).n);
}
function user(id: string): string {
  db.prepare("INSERT INTO users (id, username, password_hash, gold, created_at) VALUES (?, ?, 'test', 1000, 1)")
    .run(id, id);
  return id;
}
let serial = 0;
function fixtureHero(userId: string, dead = false, name = `Fixture${++serial}`) {
  const id = `fixture-${++serial}`;
  db.prepare(`INSERT INTO heroes (id, user_id, name, race_id, weapon_type, xp, ep_earned, skills_json, died_at, created_at)
    VALUES (?, ?, ?, ?, ?, 123, 9000, ?, ?, 1)`)
    .run(id, userId, name, content.races[0]!.id, WEAPON_TYPES[0]!, JSON.stringify({ "basic-attack": 4, "power-attack": 3 }), dead ? 10 : null);
  return heroes.getHeroRow(userId, id);
}
function createInput(draft: ReturnType<typeof heroes.createHeroDraft>, name: string) {
  return { draftId: draft.draftId, name, raceId: draft.raceIds[0]!, weaponType: draft.weaponTypes[0]! };
}
function draftRow(userId: string) {
  return one("SELECT * FROM hero_drafts WHERE user_id = ?", userId);
}

try {
  if (childMode) {
    assert.deepEqual(heroes.createHeroDraft(process.argv[3]!), JSON.parse(process.argv[4]!));
    console.log("Restart persistence passed");
  } else {
    const owner = user("draft-owner");
    const other = user("other-owner");
    const draft = heroes.createHeroDraft(owner);
    assert.equal(draft.rerollsRemaining, 1);
    assert.equal(new Set(draft.raceIds).size, 2);
    assert.equal(new Set(draft.weaponTypes).size, 3);
    assert.deepEqual(heroes.createHeroDraft(owner), draft);
    assert.equal(count("hero_drafts", owner), 1);
    const restart = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url), "--check-persisted", owner, JSON.stringify(draft)], {
      cwd: path.resolve(fileURLToPath(new URL("..", import.meta.url))), env: process.env, encoding: "utf8",
    });
    assert.equal(restart.status, 0, restart.stderr || restart.stdout);

    const input = createInput(draft, "FirstHero");
    assert.throws(() => heroes.createHero(other, input), /草稿/);
    assert.throws(() => heroes.createHero(owner, { ...input, name: "" }), /英雄名/);
    assert.throws(() => heroes.createHero(owner, { ...input, name: "<invalid>" }), /英雄名/);
    assert.throws(() => heroes.createHero(owner, { ...input, raceId: "missing" }), /过往/);
    const excludedWeapon = WEAPON_TYPES.find((value) => !draft.weaponTypes.includes(value))!;
    assert.throws(() => heroes.createHero(owner, { ...input, weaponType: excludedWeapon }), /武器/);
    fixtureHero(owner, false, input.name);
    assert.throws(() => heroes.createHero(owner, input), /英雄名/);
    assert.equal(draftRow(owner).id, draft.draftId);
    const stable = draftRow(owner);
    db.prepare("UPDATE hero_drafts SET expires_at = 1 WHERE user_id = ?").run(owner);
    const renewed = heroes.createHeroDraft(owner);
    assert.equal(renewed.draftId, draft.draftId);
    assert.deepEqual(renewed.raceIds, draft.raceIds);
    assert.deepEqual(renewed.weaponTypes, draft.weaponTypes);
    assert.equal(renewed.rerollsRemaining, 1);
    assert.ok(renewed.expiresAt > Date.now());
    assert.equal(draftRow(owner).created_at, stable.created_at);
    const rerolled = heroes.rerollHeroDraft(owner);
    assert.notEqual(rerolled.draftId, draft.draftId);
    assert.equal(rerolled.rerollsRemaining, 0);
    assert.throws(() => heroes.rerollHeroDraft(owner), /用完/);
    assert.throws(() => heroes.createHero(owner, createInput(draft, "StaleHero")), /草稿/);
    db.prepare("UPDATE hero_drafts SET expires_at = 1 WHERE user_id = ?").run(owner);
    const renewedUsed = heroes.createHeroDraft(owner);
    assert.deepEqual(renewedUsed.raceIds, rerolled.raceIds);
    assert.deepEqual(renewedUsed.weaponTypes, rerolled.weaponTypes);
    assert.equal(renewedUsed.rerollsRemaining, 0);
    assert.throws(() => heroes.rerollHeroDraft(owner), /用完/);

    // Fail at the last write to prove hero, kit, preset and draft commit together.
    const heroesBefore = count("heroes", owner);
    db.exec("CREATE TEMP TRIGGER fail_draft_delete BEFORE DELETE ON hero_drafts BEGIN SELECT RAISE(ABORT, 'draft-delete-failure'); END;");
    assert.throws(() => heroes.createHero(owner, createInput(renewedUsed, "RollbackHero")), /draft-delete-failure/);
    db.exec("DROP TRIGGER fail_draft_delete");
    assert.equal(count("heroes", owner), heroesBefore);
    assert.equal(count("inventory_items", owner), 0);
    assert.equal(count("hero_presets", owner), 0);
    assert.equal(draftRow(owner).id, renewedUsed.draftId);
    db.prepare("UPDATE hero_drafts SET expires_at = 1 WHERE user_id = ?").run(owner);
    const created = heroes.createHero(owner, createInput(renewedUsed, "SuccessHero"));
    assert.equal(created.name, "SuccessHero");
    assert.equal(count("hero_drafts", owner), 0);
    assert.ok(count("inventory_items", owner) > 0);
    assert.equal(count("hero_presets", owner), 1);
    assert.throws(() => heroes.createHero(owner, createInput(renewedUsed, "ReplayHero")), /草稿/);
    assert.equal(heroes.createHeroDraft(owner).rerollsRemaining, 1);

    const deadOwner = user("dead-owner");
    const deadRows = Array.from({ length: 8 }, () => fixtureHero(deadOwner));
    db.prepare(`INSERT INTO inventory_items (id, user_id, template_id, data_json, acquired_at, equipped_by, equipped_slot)
      VALUES ('retained-item', ?, 'test', '{}', 1, ?, 'weapon')`).run(deadOwner, deadRows[7]!.id);
    for (const hero of deadRows) assert.deepEqual(death.killHero(hero, 20), { deleted: false });
    assert.equal(death.deadHeroesOf(deadOwner).length, 8);
    assert.equal(count("hero_tombstones", deadOwner), 0);
    assert.equal(death.deathRosterView(deadOwner).needsResolution, false);
    assert.doesNotThrow(() => death.assertDeathRosterResolved(deadOwner));
    assert.equal(one("SELECT equipped_by FROM inventory_items WHERE id = 'retained-item'").equipped_by, deadRows[7]!.id);
    const extraDraft = heroes.createHeroDraft(deadOwner);
    heroes.createHero(deadOwner, createInput(extraDraft, "AliveAgain"));
    assert.equal(death.livingHeroCount(deadOwner), 1);

    const archived = heroes.getHeroRow(deadOwner, deadRows[7]!.id);
    db.prepare("INSERT INTO hero_titles (hero_id, title_id, source, unlocked_at) VALUES (?, 'saved-title', 'fame', 1)").run(archived.id);
    const goldBefore = one("SELECT gold FROM users WHERE id = ?", deadOwner).gold;
    assert.throws(() => heroes.deleteHero(deadOwner, archived.id, "wrong"), /英雄名/);
    db.exec("CREATE TEMP TRIGGER fail_archive BEFORE DELETE ON heroes BEGIN SELECT RAISE(ABORT, 'archive-failure'); END;");
    assert.throws(() => heroes.deleteHero(deadOwner, archived.id, archived.name), /archive-failure/);
    db.exec("DROP TRIGGER fail_archive");
    assert.equal(count("hero_tombstones", deadOwner), 0);
    assert.equal(one("SELECT equipped_by FROM inventory_items WHERE id = 'retained-item'").equipped_by, archived.id);
    heroes.deleteHero(deadOwner, archived.id, archived.name);
    const tomb = one("SELECT * FROM hero_tombstones WHERE user_id = ?", deadOwner);
    assert.equal(tomb.available_ep, 123);
    assert.equal(tomb.ep_earned, 9000);
    assert.equal(tomb.skills_json, archived.skills_json);
    assert.deepEqual(JSON.parse(String(tomb.titles_json)), ["saved-title"]);
    assert.equal(one("SELECT gold FROM users WHERE id = ?", deadOwner).gold, goldBefore);
    assert.equal(one("SELECT equipped_by FROM inventory_items WHERE id = 'retained-item'").equipped_by, null);
    assert.equal(one("SELECT equipped_slot FROM inventory_items WHERE id = 'retained-item'").equipped_slot, null);

    death.grantToken(deadOwner, "redemption", 1);
    const duplicate = fixtureHero(deadOwner, false, archived.name);
    assert.throws(() => death.reviveWithRedemption(deadOwner, String(tomb.id)), /UNIQUE/);
    assert.equal(death.tokenCount(deadOwner, "redemption"), 1);
    assert.equal(count("hero_tombstones", deadOwner), 1);
    db.prepare("DELETE FROM heroes WHERE id = ?").run(duplicate.id);
    const restored = death.reviveWithRedemption(deadOwner, String(tomb.id));
    assert.equal(restored.xp, 123);
    assert.equal(restored.ep_earned, 9000);
    assert.equal(restored.skills_json, archived.skills_json);
    assert.equal(one("SELECT title_id FROM hero_titles WHERE hero_id = ?", restored.id).title_id, "saved-title");
    assert.equal(one("SELECT is_default FROM hero_presets WHERE hero_id = ?", restored.id).is_default, 1);
    assert.equal(death.tokenCount(deadOwner, "redemption"), 0);
    assert.equal(count("hero_tombstones", deadOwner), 0);
    assert.throws(() => death.reviveWithRedemption(deadOwner, String(tomb.id)), /不存在/);

    const legacy = heroes.getHeroRow(deadOwner, deadRows[0]!.id);
    heroes.deleteHero(deadOwner, legacy.id, legacy.name);
    const legacyTomb = one("SELECT * FROM hero_tombstones WHERE user_id = ?", deadOwner);
    db.prepare("UPDATE hero_tombstones SET available_ep = NULL WHERE id = ?").run(String(legacyTomb.id));
    death.grantToken(deadOwner, "redemption", 1);
    const legacyRestored = death.reviveWithRedemption(deadOwner, String(legacyTomb.id));
    assert.equal(legacyRestored.xp, 0);
    assert.equal(legacyRestored.skills_json, legacy.skills_json);

    const pardonHero = heroes.getHeroRow(deadOwner, deadRows[1]!.id);
    death.grantToken(deadOwner, "pardon", 1);
    db.exec("CREATE TEMP TRIGGER fail_pardon BEFORE UPDATE OF died_at ON heroes BEGIN SELECT RAISE(ABORT, 'pardon-failure'); END;");
    assert.throws(() => death.reviveWithPardon(deadOwner, pardonHero.id), /pardon-failure/);
    db.exec("DROP TRIGGER fail_pardon");
    assert.equal(death.tokenCount(deadOwner, "pardon"), 1);
    assert.notEqual(heroes.getHeroRow(deadOwner, pardonHero.id).died_at, null);
    const pardoned = death.reviveWithPardon(deadOwner, pardonHero.id);
    assert.equal(pardoned.died_at, null);
    assert.equal(pardoned.xp, pardonHero.xp);
    assert.equal(pardoned.skills_json, pardonHero.skills_json);
    assert.equal(death.tokenCount(deadOwner, "pardon"), 0);

    const fullOwner = user("full-owner");
    const fullDraft = heroes.createHeroDraft(fullOwner);
    for (let i = 0; i < MAX_HEROES_PER_ACCOUNT; i += 1) fixtureHero(fullOwner);
    const fullDead = fixtureHero(fullOwner, true);
    death.grantToken(fullOwner, "pardon", 1);
    death.grantToken(fullOwner, "redemption", 1);
    assert.throws(() => death.reviveWithPardon(fullOwner, fullDead.id), /名册已满/);
    assert.equal(death.tokenCount(fullOwner, "pardon"), 1);
    heroes.deleteHero(fullOwner, fullDead.id, fullDead.name);
    const fullTomb = one("SELECT id FROM hero_tombstones WHERE user_id = ?", fullOwner);
    assert.throws(() => death.reviveWithRedemption(fullOwner, String(fullTomb.id)), /名册已满/);
    assert.equal(death.tokenCount(fullOwner, "redemption"), 1);
    assert.equal(count("hero_tombstones", fullOwner), 1);
    // 抽选查看不再受名册限制（创建时才检查容量）；draft 应成功返回。
    const fullDraftView = heroes.createHeroDraft(fullOwner);
    assert.ok(fullDraftView.draftId);
    assert.throws(() => heroes.createHero(fullOwner, createInput(fullDraftView, "Overflow")), /名册已满/);
    assert.equal(draftRow(fullOwner).id, fullDraftView.draftId);
    assert.equal(draftRow(fullOwner).rerolls_used, 0);
    console.log("Death/draft regression passed: persistence, expiry, one reroll, validation, transaction rollback, retained gear, archive snapshot, legacy EP/skills, revival capacity and presets.");
  }
} finally {
  db.close();
  if (temporary) rmSync(temporary, { recursive: true, force: true });
}
