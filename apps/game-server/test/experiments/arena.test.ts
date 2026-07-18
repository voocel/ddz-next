import { describe, expect, it } from "vitest";
import {
  buildReport,
  computeElo,
  contestantKeys,
  parseLineup,
  runTournament,
  seatForContestant,
  type ArenaCliOptions,
  type CompletedGame,
  type Contestant
} from "../../src/experiments/arena";
import { RuleBotBrain } from "../../src/rooms/ruleBotBrain";
import type { BotBrain } from "../../src/rooms/botBrain";

describe("parseLineup", () => {
  it("解析 provider/model 与 rule 混排,model 里的斜杠归 model", () => {
    expect(parseLineup("anthropic/claude-haiku-4-5,rule,openai/org/model-x")).toEqual([
      { provider: "anthropic", model: "claude-haiku-4-5" },
      "rule",
      { provider: "openai", model: "org/model-x" }
    ]);
  });

  it("席位数不是 3 或格式非法都拒绝", () => {
    expect(() => parseLineup("rule,rule")).toThrow(/恰好 3 个/);
    expect(() => parseLineup("rule,rule,")).toThrow(/恰好 3 个/);
    expect(() => parseLineup("rule,rule,no-slash")).toThrow(/不合法/);
    expect(() => parseLineup("rule,rule,/model")).toThrow(/不合法/);
  });
});

describe("contestantKeys", () => {
  it("同模型多席位追加 #2/#3,各自独立计分", () => {
    expect(
      contestantKeys([
        { provider: "a", model: "m" },
        { provider: "a", model: "m" },
        "rule"
      ])
    ).toEqual(["a/m", "a/m#2", "rule"]);
  });
});

describe("seatForContestant", () => {
  it("每个 board 内三次轮转让每位选手把三个座位各坐一遍", () => {
    for (let contestant = 0; contestant < 3; contestant += 1) {
      const seats = [0, 1, 2].map((rotation) => seatForContestant(contestant, rotation));
      expect(new Set(seats).size).toBe(3);
    }
    // 同一轮转内三人座位互不相同
    for (let rotation = 0; rotation < 3; rotation += 1) {
      const seats = [0, 1, 2].map((contestant) => seatForContestant(contestant, rotation));
      expect(new Set(seats).size).toBe(3);
    }
  });
});

describe("computeElo", () => {
  it("地主赢从两位农民各赚一场,输则各赔一场;总分守恒", () => {
    const game: CompletedGame = {
      board: 0,
      rotation: 0,
      landlordKey: "a",
      landlordWon: true,
      outcomes: [
        { key: "a", seat: "bot:p0", role: "landlord", scoreDelta: 4, won: true },
        { key: "b", seat: "bot:p1", role: "farmer", scoreDelta: -2, won: false },
        { key: "c", seat: "bot:p2", role: "farmer", scoreDelta: -2, won: false }
      ]
    };
    const ratings = computeElo([game], ["a", "b", "c"]);
    expect(ratings.a).toBeGreaterThan(1000);
    expect(ratings.b).toBeLessThan(1000);
    expect(ratings.c).toBeLessThan(1000);
    expect(ratings.a! + ratings.b! + ratings.c!).toBeCloseTo(3000, 6);
  });
});

function ruleContestant(key: string): Contestant {
  return { key, ref: null, brain: new RuleBotBrain(), metrics: [] };
}

const baseOptions: ArenaCliOptions = {
  lineup: ["rule", "rule", "rule"],
  boards: 1,
  seed: "vitest",
  concurrency: 2,
  out: null
};

describe("runTournament", () => {
  it("规则阵容跑满 boards×3 局,复式对称:同 board 三轮转合计分守恒为零", async () => {
    const contestants = [ruleContestant("rule"), ruleContestant("rule#2"), ruleContestant("rule#3")];
    const result = await runTournament(contestants, { boards: 1, seed: "vitest", concurrency: 3 });

    expect(result.completed).toHaveLength(3);
    expect(result.aborted).toHaveLength(0);
    // 每位选手三局各坐一个座位;确定性规则 bot 下三轮转互为镜像,人人累计分为 0
    const report = buildReport(contestants, baseOptions, result, 0);
    for (const contestant of report.contestants) {
      expect(contestant.games).toBe(3);
      expect(contestant.landlordGames + contestant.farmerGames).toBe(3);
      expect(contestant.totalScore).toBe(0);
    }
  });

  it("决策抛错的局记流局并把技术负归到抛错选手,其余局照常完成", async () => {
    const exploding: BotBrain = {
      decide: () => Promise.reject(new Error("boom"))
    };
    const contestants: Contestant[] = [
      { key: "bad", ref: null, brain: exploding, metrics: [] },
      ruleContestant("rule"),
      ruleContestant("rule#2")
    ];
    const result = await runTournament(contestants, { boards: 1, seed: "vitest", concurrency: 1 });

    // bad 选手每局第一手就炸:三轮转全部流局
    expect(result.completed).toHaveLength(0);
    expect(result.aborted).toHaveLength(3);
    expect(result.aborted.every((game) => game.contestant === "bad")).toBe(true);
    expect(result.aborted[0]!.message).toBe("boom");

    const report = buildReport(contestants, baseOptions, result, 0);
    expect(report.contestants.find((contestant) => contestant.key === "bad")?.aborts).toBe(3);
    expect(report.games).toEqual({ total: 3, completed: 0, aborted: 3 });
  });
});
