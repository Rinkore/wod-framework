import { Link } from "react-router-dom";
import { Clock, Heart, Shield, Sparkles, Swords, Zap } from "lucide-react";
import { BASE_STAT_KEYS, BASE_STAT_SHORT_LABELS } from "@wod/shared";
import type { HeroView } from "@wod/shared";
import { MAX_LEVEL, epForLevel } from "@wod/engine";
import { Badge, Bar, Sigil, cx } from "./ui";
import { heroActions, heroFinalStats, heroPhysicalReduction } from "../heroStats";

export function HeroCard({ hero, compact = false }: { hero: HeroView; compact?: boolean }) {
  const busy = Boolean(hero.busyExpeditionId);
  const died = Boolean(hero.diedAt);
  const status = busy ? "远征中" : died ? "已死亡" : "待命";
  const tone = busy ? "gold" : died ? "red" : "green";
  const levelFloor = epForLevel(hero.level);
  const levelCeil = epForLevel(hero.level + 1);
  const levelSpan = Math.max(1, levelCeil - levelFloor);
  const finalStats = heroFinalStats(hero);
  const actions = heroActions(hero);
  const reduction = heroPhysicalReduction(hero);

  return (
    <Link to={`/heroes/${hero.id}`} className={cx("hero-card card", compact && "hero-card-compact")}>
      <div className="hero-card-head">
        <Sigil weaponType={hero.pathWeaponType} color={hero.weaponColor ?? "#c9a227"} size={compact ? "md" : "lg"} />
        <div className="hero-identity">
          <h3>{hero.name}</h3>
          <span>
            {hero.raceName} · {hero.weaponName} · 等级 {hero.level}
          </span>
          {hero.activeTitle ? (
              <em
                className="hero-title-tag"
                style={{ color: hero.activeTitle.color }}
              >
                · {hero.activeTitle.name}
              </em>
            ) : hero.fame > 0 ? (
              <em className="hero-title-tag">· {hero.fame} 声望</em>
            ) : null}
        </div>
        <Badge tone={tone}> {status}</Badge>
      </div>

      {!compact ? (
        <>
          <div className="hero-xp">
            <span>
              {hero.level >= MAX_LEVEL
                ? "已满级"
                : `经验点 ${hero.epEarned - levelFloor} / ${levelSpan}`}
            </span>
            <Bar
              value={hero.level >= MAX_LEVEL ? 1 : hero.epEarned - levelFloor}
              max={hero.level >= MAX_LEVEL ? 1 : levelSpan}
            />
          </div>

          <div className="hero-metrics">
            <span>
              <Swords size={14} /> 战力 {hero.power}
            </span>
            <span>
              <Heart size={14} /> {hero.maxHp}
            </span>
            <span title="对同级标准物理攻击的减伤率">
              <Shield size={14} /> {Math.round(hero.armor * 10) / 10}
              {reduction !== undefined ? `（${Math.round(reduction * 100)}%）` : ""}
            </span>
            <span>
              <Zap size={14} /> {hero.maxEnergy}
            </span>
            <span title="先攻决定行动顺序；每回合固定一次主要行动">
              <Clock size={14} /> {hero.initiative}（{actions} 行动）
            </span>
          </div>

          <div className="hero-stats">
            {BASE_STAT_KEYS.map((key) => (
              <div key={key} className="hero-stat">
                <span>{BASE_STAT_SHORT_LABELS[key]}</span>
                <strong>
                  {key === "hit" && hero.hitRate !== undefined
                    ? `${Math.round(finalStats[key] * 10) / 10}（${Math.round(hero.hitRate * 100)}%）`
                    : key === "evasion" && hero.evasionRate !== undefined
                      ? `${Math.round(finalStats[key] * 10) / 10}（${Math.round(hero.evasionRate * 100)}%）`
                      : key === "armor" && reduction !== undefined
                        ? `${Math.round(finalStats[key] * 10) / 10}（${Math.round(reduction * 100)}%）`
                        : key === "initiative"
                          ? `${finalStats[key]}（${actions} 行动）`
                          : key === "crit"
                            ? `${Math.round(finalStats[key] * 10) / 10}%`
                            : Math.round(finalStats[key] * 10) / 10}
                </strong>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="hero-compact-foot">
          <span>战力 {hero.power}</span>
          <span>{hero.maxHp} 生命</span>
          <span>
            {Math.round(hero.armor * 10) / 10} 护甲
            {reduction !== undefined ? `（${Math.round(reduction * 100)}%）` : ""}
          </span>
          <span className="text-gold">
            <Sparkles size={13} /> {hero.ep} 经验点
          </span>
        </div>
      )}

      {!compact && hero.ep > 0 ? (
        <div className="hero-card-note">
          <Sparkles size={14} /> 有 {hero.ep} 经验点可用于训练
        </div>
      ) : null}
    </Link>
  );
}
