import type { ItemRoll, Slot } from "@wod/shared";

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  gold: number;
  premium: number;
  registration_ip_hash: string | null;
  created_at: number;
}

export interface HeroRow {
  id: string;
  user_id: string;
  name: string;
  race_id: string;
  weapon_type: string;
  level: number;
  xp: number;
  ep_earned: number;
  skills_json: string;
  duel_wins: number;
  duel_losses: number;
  duel_rating: number;
  injured_until: number | null;
  /** 永久死亡时间；null 表示存活。 */
  died_at: number | null;
  fame: number;
  active_title_id: string | null;
  created_at: number;
}

export interface ItemRow {
  id: string;
  user_id: string;
  template_id: string;
  data_json: string;
  acquired_at: number;
  equipped_by: string | null;
  equipped_slot: Slot | null;
  quantity: number;
}

export interface QuestProgressRow {
  user_id: string;
  quest_id: string;
  status: "active" | "completed" | "claimed";
  progress_json: string;
  started_at: number;
  updated_at: number;
  completed_at: number | null;
  claimed_at: number | null;
}

export interface ExpeditionRow {
  id: string;
  user_id: string;
  dungeon_id: string;
  route_id: string | null;
  depth: number | null;
  /** 迷宫路径（房间 id 列表 JSON）；旧存档缺省。 */
  room_path_json?: string | null;
  maze_series_id?: string | null;
  maze_depth?: number | null;
  maze_generator_version?: number | null;
  maze_snapshot_json?: string | null;
  hero_ids_json: string;
  seed: number;
  group_id: string | null;
  status: "running" | "completed";
  start_at: number;
  end_at: number;
  settled_at: number | null;
  result_json: string | null;
  created_at: number;
}

export interface EquippedRoll {
  templateId: string;
  affixes: ItemRoll["affixes"];
}

