import { useMemo, useState } from "react";
import { BookOpen, Search } from "lucide-react";
import {
  AFFINITY_PERK_LABELS,
  AFFINITY_PERK_TEXTS,
  BASE_STAT_KEYS,
  BASE_STAT_LABELS,
  DAMAGE_TYPE_LABELS,
  ITEM_SLOT_LABELS,
  RARITY_LABELS,
  WEAPON_TYPE_LABELS,
  type Skill,
} from "@wod/shared";
import { useContent } from "../context";
import { Badge, Card, PageHeader, cx, weaponIcon } from "../components/ui";

type Tab = "races" | "weapons" | "skills" | "items" | "monsters" | "dungeons";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "races", label: "过往" },
  { id: "weapons", label: "武器树" },
  { id: "skills", label: "技能" },
  { id: "items", label: "物品" },
  { id: "monsters", label: "怪物" },
  { id: "dungeons", label: "迷宫" },
];

const SKILL_KIND: Record<Skill["kind"], string> = {
  attack: "攻击",
  heal: "治疗",
  buff: "增益",
  passive: "被动",
  trait: "特质",
};

function baseChips(base: Record<string, number>) {
  return BASE_STAT_KEYS.map((key) => (
    <span key={key} className="bonus-pos">
      {BASE_STAT_LABELS[key]} {Math.round((base[key] ?? 0) * 10) / 10}
    </span>
  ));
}

export function CodexPage() {
  const content = useContent();
  const [tab, setTab] = useState<Tab>("races");
  const [query, setQuery] = useState("");

  const needle = query.trim().toLowerCase();
  const match = (...parts: Array<string | number | undefined>) =>
    !needle || parts.join(" ").toLowerCase().includes(needle);

  const races = useMemo(
    () => content.races.filter((row) => match(row.name, row.subtitle, row.description, row.trait.name)),
    [content.races, needle],
  );
  const weapons = useMemo(
    () => content.weapons.filter((row) => match(row.name, row.description)),
    [content.weapons, needle],
  );
  const skills = useMemo(
    () =>
      content.skills.filter((row) =>
        match(
          row.name,
          row.description,
          SKILL_KIND[row.kind],
          row.damageType ? DAMAGE_TYPE_LABELS[row.damageType] : "",
        ),
      ),
    [content.skills, needle],
  );
  const items = useMemo(
    () =>
      content.items.filter((row) =>
        match(row.name, row.description, row.weaponType ? WEAPON_TYPE_LABELS[row.weaponType] : ""),
      ),
    [content.items, needle],
  );
  const monsters = useMemo(
    () => content.monsters.filter((row) => match(row.name, row.subtitle, row.description)),
    [content.monsters, needle],
  );
  const dungeons = useMemo(
    () => content.dungeons.filter((row) => match(row.name, row.description, row.theme)),
    [content.dungeons, needle],
  );

  return (
    <div className="page">
      <PageHeader
        eyebrow="图鉴"
        title="荒原档案"
      />

      <div className="hub-chips">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={cx("hub-chip", tab === entry.id && "hub-chip-active")}
            onClick={() => {
              setTab(entry.id);
              setQuery("");
            }}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <label className="search-box">
        <Search size={15} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索"
        />
      </label>

      {tab === "races" ? (
        <div className="codex-grid">
          {races.map((race) => (
            <Card key={race.id} className="codex-card">
              <div className="section-head compact">
                <h2>{race.name}</h2>
                <Badge tone="muted">{race.subtitle}</Badge>
              </div>
              <p className="muted-text">{race.description}</p>
              <div className="bonus-chips">{baseChips(race.base)}</div>
              {(race.passive?.hpPct ?? 0) !== 0 ? (
                <p className="muted-text">生命 {Math.round((race.passive?.hpPct ?? 0) * 100)}%</p>
              ) : null}
              {(race.passive?.manaPct ?? 0) !== 0 ? (
                <p className="muted-text">法力 {Math.round((race.passive?.manaPct ?? 0) * 100)}%</p>
              ) : null}
              <p className="muted-text">
                特质：{race.trait.name} — {race.trait.description}
              </p>
              {race.dungeonAffinity ? (
                <>
                  <p className="muted-text">
                    亲和：{AFFINITY_PERK_LABELS[race.dungeonAffinity.perk]} ·{" "}
                    {race.dungeonAffinity.tags.join(" / ")}
                  </p>
                  <p className="muted-text">
                    {AFFINITY_PERK_TEXTS[race.dungeonAffinity.perk]}
                  </p>
                </>
              ) : null}
            </Card>
          ))}
        </div>
      ) : null}

      {tab === "weapons" ? (
        <div className="codex-grid">
          {weapons.map((path) => {
            const Icon = weaponIcon(path.id);
            const nodes = content.skillTrees.weapons[path.id] ?? [];
            const root = content.skills.find((skill) => skill.id === path.rootSkillId);
            return (
              <Card key={path.id} className="codex-card">
                <div className="section-head compact">
                  <h2>
                    <Icon size={18} /> {path.name}
                  </h2>
                  <Badge tone="muted">{WEAPON_TYPE_LABELS[path.id]}</Badge>
                </div>
                <p className="muted-text">{path.description}</p>
                <p className="muted-text">
                  起始技能：{root?.name ?? path.rootSkillId} · 起始装备：
                  {path.startingItemIds
                    .map((id) => content.items.find((item) => item.id === id)?.name ?? id)
                    .join(" / ")}
                </p>
                <div className="skill-chips">
                  {nodes.map((node) => {
                    const skill = content.skills.find((row) => row.id === node.id);
                    return (
                      <span key={`${path.id}-${node.id}`}>
                        T{node.tier} {skill?.name ?? node.id}
                      </span>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      ) : null}

      {tab === "skills" ? (
        <div className="codex-list">
          {skills.map((skill) => (
            <Card key={skill.id} className="codex-row">
              <div className="codex-row-head">
                <strong>{skill.name}</strong>
                <Badge
                  tone={
                    skill.kind === "passive" || skill.kind === "trait"
                      ? "purple"
                      : skill.kind === "heal"
                        ? "green"
                        : skill.kind === "buff"
                          ? "blue"
                          : "muted"
                  }
                >
                  {SKILL_KIND[skill.kind]}
                </Badge>
                {skill.damageType ? (
                  <Badge tone="muted">{DAMAGE_TYPE_LABELS[skill.damageType]}</Badge>
                ) : null}
                {skill.weaponTypes?.length ? (
                  <Badge tone="gold">
                    {skill.weaponTypes.map((type) => WEAPON_TYPE_LABELS[type]).join(" / ")}
                  </Badge>
                ) : null}
              </div>
              <p className="muted-text">{skill.description}</p>
              <div className="codex-meta">
                <span>等级系数 {skill.levelScale}</span>
                <span>武器倍率 {skill.weaponScale}</span>
                <span>冷却 {skill.cooldown}</span>
                <span>法力 {skill.energyCost}</span>
                {skill.range ? <span>范围 {skill.range}</span> : null}
                {skill.passive ? (
                  <span>
                    被动：生命 {Math.round(skill.passive.hpPct * 100)}% · 法力{" "}
                    {Math.round(skill.passive.manaPct * 100)}%
                  </span>
                ) : null}
              </div>
              {skill.effects.length > 0 ? (
                <div className="skill-chips">
                  {skill.effects.map((effect, index) => (
                    <span key={index}>
                      {effect.type}
                      {effect.type === "mod" ? ` ${effect.kind} ${effect.base}` : ""}
                      {effect.type === "dot" || effect.type === "hot" || effect.type === "shield"
                        ? ` ${effect.base}+${effect.perLevel}/级`
                        : ""}
                    </span>
                  ))}
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      ) : null}

      {tab === "items" ? (
        <div className="codex-grid">
          {items.map((item) => (
            <Card key={item.id} className="codex-card">
              <div className="section-head compact">
                <h3>{item.name}</h3>
                <Badge tone="muted">{RARITY_LABELS[item.rarity]}</Badge>
              </div>
              <p className="muted-text">{item.description}</p>
              <div className="bonus-chips">
                <span className="bonus-pos">等级 {item.level}</span>
                <span className="bonus-pos">{ITEM_SLOT_LABELS[item.slot]}</span>
                {item.weaponType ? (
                  <span className="bonus-pos">{WEAPON_TYPE_LABELS[item.weaponType]}</span>
                ) : null}
                {item.weaponDamage ? (
                  <span className="bonus-pos">武器伤害 {item.weaponDamage}</span>
                ) : null}
                {item.armor ? <span className="bonus-pos">护甲 {item.armor}</span> : null}
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      {tab === "monsters" ? (
        <div className="codex-grid">
          {monsters.map((monster) => (
            <Card key={monster.id} className="codex-card">
              <div className="section-head compact">
                <h3>{monster.name}</h3>
                <Badge tone="muted">Lv{monster.level}</Badge>
              </div>
              <p className="muted-text">{monster.description}</p>
              <div className="bonus-chips">{baseChips(monster.base)}</div>
              <p className="muted-text">
                HP 倍率 {monster.hpMultiplier} · 伤害倍率 {monster.damageMultiplier}
              </p>
              <div className="skill-chips">
                {monster.skillIds.map((id) => {
                  const skill = content.skills.find((row) => row.id === id);
                  return <span key={id}>{skill?.name ?? id}</span>;
                })}
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      {tab === "dungeons" ? (
        <div className="codex-grid">
          {dungeons.map((dungeon) => (
            <Card key={dungeon.id} className="codex-card">
              <div className="section-head compact">
                <h2>{dungeon.name}</h2>
                <Badge tone="muted">{dungeon.rooms.length} 房</Badge>
              </div>
              <p className="muted-text">{dungeon.description}</p>
              <div className="bonus-chips">
                {dungeon.tags.map((tag) => (
                  <span key={tag} className="bonus-pos">
                    {tag}
                  </span>
                ))}
              </div>
              <div className="skill-chips">
                {dungeon.rooms.map((room) => (
                  <span key={room.id}>
                    {room.name}（{room.kind}）
                  </span>
                ))}
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      {((tab === "races" && races.length === 0) ||
        (tab === "weapons" && weapons.length === 0) ||
        (tab === "skills" && skills.length === 0) ||
        (tab === "items" && items.length === 0) ||
        (tab === "monsters" && monsters.length === 0) ||
        (tab === "dungeons" && dungeons.length === 0)) && (
        <Card>
          <p className="muted-text">
            <BookOpen size={14} /> 没有匹配的条目。
          </p>
        </Card>
      )}
    </div>
  );
}
