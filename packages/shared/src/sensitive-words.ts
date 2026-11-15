/**
 * 英雄名敏感词过滤。
 * 说明：这是基础的内容安全检查，命中即拒绝；词表可按运营需要随时扩充。
 * 匹配前会去掉空白、标点与符号，避免用空格/符号绕过。
 */
const SENSITIVE_WORDS = [
  // 侮辱与脏话
  "傻逼",
  "傻b",
  "煞笔",
  "沙比",
  "智障",
  "弱智",
  "脑残",
  "废物",
  "狗东西",
  "狗杂种",
  "杂种",
  "贱人",
  "婊子",
  "妓女",
  "操你",
  "草泥马",
  "草拟妈",
  "尼玛",
  "你妈",
  "妈妈的",
  "他妈的",
  "妈的",
  "法克",
  "fuck",
  "shit",
  "bitch",
  // 涉黄低俗
  "性交",
  "做爱",
  "裸体",
  "色情",
  "黄片",
  "约炮",
  "一夜情",
  // 违法与危险内容
  "毒品",
  "冰毒",
  "海洛因",
  "枪支",
  "炸弹",
  "恐怖袭击",
  "杀人",
  "自杀",
  "赌博",
  "洗钱",
  "诈骗",
  "传销",
];

/** 去掉空白、标点和符号后再匹配，防止「傻 逼」「傻*逼」这类绕过。 */
function normalizeName(text: string): string {
  return text.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

/** 英雄名是否包含敏感词。 */
export function containsSensitiveWord(text: string): boolean {
  const normalized = normalizeName(text);
  if (!normalized) return false;
  return SENSITIVE_WORDS.some((word) => normalized.includes(normalizeName(word)));
}
