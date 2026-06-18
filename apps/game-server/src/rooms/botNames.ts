/**
 * 机器人展示昵称：生成"一眼可辨认是机器人、但各有个性"的名字（产品口径：玩家应能认出机器人，
 * 其余表现——头像、回合倒计时——与真人一致）。仅服务端使用：生成后存入房间 nicknames 表，
 * 随快照下发并参与崩溃恢复。
 */
const BOT_NAMES: readonly string[] = [
  "AI小七",
  "AI阿强",
  "AI老王",
  "AI豆豆",
  "机器人阿福",
  "机器人大牛",
  "机器人诸葛",
  "电脑阿黄",
  "电脑铁柱",
  "电脑阿珍"
];

/**
 * 选取 count 个互不相同、且不与 taken 中已用昵称冲突的机器人昵称。
 * 池子用尽（极端情况）时回退到带序号的"机器人N"，保证非空且唯一。
 */
export function pickBotNicknames(count: number, taken: Iterable<string> = []): string[] {
  const used = new Set(taken);
  const pool = BOT_NAMES.filter((name) => !used.has(name));
  // 简单洗牌：从可用池里随机取，避免每局固定顺序
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }

  const picked: string[] = [];
  for (let i = 0; i < count; i += 1) {
    let name = pool.pop();
    if (!name) {
      let n = 1;
      while (used.has(`机器人${n}`)) {
        n += 1;
      }
      name = `机器人${n}`;
    }
    used.add(name);
    picked.push(name);
  }
  return picked;
}
