import { CARDS, CARD_KINDS } from '../shared/cards';
import { DEFAULT_CLUE_ODDS, DEFAULT_RULES } from '../shared/rules';

/**
 * 规则说明正文。大厅设置与牌桌设置共用同一份，避免两处文案各写一遍后走样。
 * 数字全部取自 DEFAULT_RULES，房主改过的参数会以「默认值」口径说明。
 */
export function RulesDoc() {
  const total = CARDS.reduce((sum, c) => sum + c.copies, 0);
  const kinds = Object.entries(CARD_KINDS);
  const rules = DEFAULT_RULES;
  const tiers = ['基础', '进阶', '关键', '终极'] as const;
  return (
    <div className="rules-doc">
      <p className="rules-lead">
        你们各自藏了一首歌。出牌换线索，先猜中对方底牌的人获胜。
      </p>

      <h4>胜利条件</h4>
      <ul className="rules-list">
        <li>
          <b>猜中对方的底牌</b>：输入歌名，猜对立即结束对局。
        </li>
        <li>
          <b>把对方的压力推满</b>：压力到顶的那一方立刻判负。
        </li>
        <li>
          双方同时到顶算<b>平局</b>。除此之外没有别的输法——
          <b>牌库摸空、行动点用完都不会输</b>。
        </li>
      </ul>

      <h4>一局怎么走</h4>
      <ol className="rules-steps">
        <li>
          <b>藏歌</b>：从 QQ 音乐挑一首宝藏歌曲当底牌，只有自己看得到。
        </li>
        <li>
          <b>选事件</b>：第 1、3、4 轮开局各从 3 张事件卡里选 1 张（银 → 金 →
          棱彩），双方都确认后才开打。
        </li>
        <li>
          <b>出牌</b>：轮流出牌，用行动点换线索、施压或响应。
        </li>
        <li>
          <b>猜歌</b>：整局限 1 次，猜中即结束对局，猜错扣压力。
        </li>
      </ol>

      <h4>一个回合里发生什么</h4>
      <ol className="rules-steps">
        <li>
          <b>回合开始</b>：行动点补到 {rules.startingEnergy}（上限{' '}
          {rules.maxEnergy}），摸 {rules.drawPerTurn} 张牌。
        </li>
        <li>
          <b>出牌</b>：任意张，只要付得起行动点；也可以随时停手。
        </li>
        <li>
          <b>响应</b>：被打中时用响应牌（如《蓝调》）抵消，<b>不花行动点</b>。
        </li>
        <li>
          <b>结束回合</b>：手牌超过 {rules.handLimit} 张要弃到 {rules.handLimit}{' '}
          张，然后换对手。
        </li>
      </ol>

      <h4>桌上两种资源</h4>
      <ul className="rules-list">
        <li>
          <b>行动点</b>：轮到你时给 {rules.startingEnergy} 点（上限{' '}
          {rules.maxEnergy}）。出牌要付行动点。
          <b>点数用完后仍然可以免费响应和猜歌</b>，所以别怕打空。
        </li>
        <li>
          <b>压力</b>：上限 {rules.pressureLimit}，被打中 +
          {rules.damagePressure}
          ，猜错 +{rules.guessMissPressure}，领线索还要按档位付{' '}
          {rules.cluePressure[1]} / {rules.cluePressure[2]} /{' '}
          {rules.cluePressure[3]} / {rules.cluePressure[4]}。
        </li>
      </ul>

      <div className="rules-warn">
        <b>⚠ 最容易输的一种方式：把自己打爆</b>
        <p>
          信息牌（《引子》《升 Key》《猜先》）
          <b>不是免费抽卡</b>：抽到哪一档就按 6 / 11 / 16 / 20 付压力，升 Key
          另外 +5。<b>压力只差几点时打信息牌，等于自己按下了判负键</b>
          ——付完压力到顶，当场输，对手什么都不用做。
        </p>
        <p>
          出牌前先看自己还剩多少额度：<b>剩余压力 ≤ 这张牌的最低代价就别打了</b>
          。实在要抽，先用《奏鸣》把压力降下来。选中信息牌时，确认条上会直接算出
          「这一下会不会让你到顶」。
        </p>
      </div>

      <h4>线索有四档</h4>
      <p>
        基础 → 进阶 → 关键 → 终极。<b>轮次越靠后越容易抽到高档</b>
        ，终极线索第 4 轮起才会出现；第 1 轮只会出基础与进阶（表里关键档的概率会
        顺延给进阶），第 2–3 轮最高到关键。
      </p>
      <div className="rules-scroll">
        <table className="rules-table">
          <thead>
            <tr>
              <th>档位</th>
              <th>压力</th>
              <th>第1轮</th>
              <th>第2轮</th>
              <th>第3轮</th>
              <th>第4轮+</th>
            </tr>
          </thead>
          <tbody>
            {tiers.map((label, i) => (
              <tr key={label}>
                <td>{label}</td>
                <td>{rules.cluePressure[(i + 1) as 1 | 2 | 3 | 4]}</td>
                {[1, 2, 3, 4].map((r) => (
                  <td key={r}>
                    {DEFAULT_CLUE_ODDS[r as 1 | 2 | 3 | 4][i] ?? 0}%
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        概率是默认值，房主可以在设置里改。抽到的档位如果没有剩余资料，会顺延到相邻
        档位，不会给空奖励。
      </p>
      <p>
        还有一个隐藏机制：<b>两条同档线索会自动合成一条更高档的</b>
        ，而且可以连锁合成、一次连跳两档。所以别嫌低档线索占地方——它们是你通往
        关键线索的原料。
      </p>

      <h4>猜歌只有一次机会</h4>
      <p>
        默认每人<b>整局就 1 次</b>
        主动猜歌，按钮角上的数字就是你还剩几次。猜中立即 获胜；猜错扣{' '}
        {rules.guessMissPressure} 压力，机会照样消耗，而且
        <b>双方都会看到你猜的是哪首歌</b>
        ——等于告诉对手你排除了什么。压力本来就高的时候，猜错也可能直接到顶。
      </p>
      <p>
        想多猜几次只能靠事件和成长牌：有的每轮送一次免费猜歌，有的给一次「盲猜」
        （猜错不消耗次数，但固定罚 25
        压力）。看到这类事件时，优先度往往高于拿线索。
      </p>
      <p>
        如果房主设置了轮数上限，打到最后一轮结束时双方都要提交最终猜歌，猜错的
        一方判负；默认不设上限，对局会一直打到有人猜中或有人压力到顶。
      </p>

      <h4>试听线索</h4>
      <p>
        终极档里的「试听」线索按 10 秒一段解锁，最多 60 秒。解锁后可以在线索栏里
        直接播放官方试听，边听边猜；换歌或对局结束就失效。
      </p>

      <h4>事件卡</h4>
      <p>
        第 1、3、4 轮开局各选一次，三选一，同一张卡可以<b>免费刷新 1 次</b>
        ，选完不能改。事件会改写这一轮的规则：临时加压、封锁手牌、限制行动、
        给一张成长牌，甚至让本轮线索免压力。
      </p>

      <h4>练习对战</h4>
      <p>
        电脑会按<b>你自己的账号权限</b>抽曲目，行为和真人一样受规则限制：不看你
        底牌、不偷看猜拳，也不会用你还没解锁的信息。它每步思考约 0.35 秒，看起来
        会比你慢半拍，这是设计好的节奏。
      </p>

      <h4>常见疑问</h4>
      <ul className="rules-list">
        <li>
          <b>我什么都没干怎么就输了？</b>{' '}
          看结算页的「压力到顶」说明：那里会写最后一击是挨打、猜错，还是你自己
          买线索付爆的。
        </li>
        <li>
          <b>为什么手牌被强制弃掉？</b> 回合结束时手牌上限是 {rules.handLimit}{' '}
          张，多出来的必须弃，弃掉的牌会 进弃牌堆，牌库摸空时洗回来。
        </li>
        <li>
          <b>为什么线索变灰了？</b> 它被拿去合成更高档的线索了。原料会留在列表里
          显示为「已合成」，不再参与结算。
        </li>
        <li>
          <b>行动点用完了还能做什么？</b>{' '}
          免费响应、猜歌、结束回合；也可以用过牌或和声把点数补回来。
        </li>
      </ul>

      <details className="rules-deck">
        <summary>卡库 · {total} 张</summary>
        {kinds.map(([kind, meta]) => (
          <div key={kind} className="rules-card-group">
            <h5>
              {meta.label}
              <span>{meta.symbol}</span>
            </h5>
            {CARDS.filter((c) => c.kind === kind).map((c) => (
              <p key={c.id} className="rules-card">
                <b>{c.title}</b>
                <i>×{c.copies}</i>
                {c.description}
              </p>
            ))}
          </div>
        ))}
      </details>
    </div>
  );
}
