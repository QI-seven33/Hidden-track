import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_RULES } from '../src/shared/rules';
import {
  infoCardMinPressure,
  selfHarmWarning,
} from '../src/client/pressure-risk';

/** 信息牌最低代价：引子最低档、升 Key 另加 5、猜先按本轮固定档。 */
test('信息牌最低压力代价按牌与本轮档位计算', () => {
  assert.equal(infoCardMinPressure('information', DEFAULT_RULES, 1), 6);
  assert.equal(infoCardMinPressure('probe', DEFAULT_RULES, 1), 11);
  assert.equal(infoCardMinPressure('rps', DEFAULT_RULES, 1), 6);
  assert.equal(infoCardMinPressure('rps', DEFAULT_RULES, 3), 16);
  assert.equal(infoCardMinPressure('rps', DEFAULT_RULES, 9), 20);
  assert.equal(infoCardMinPressure('strike', DEFAULT_RULES, 1), 0);
  assert.equal(infoCardMinPressure('breathe', DEFAULT_RULES, 1), 0);
});

/** 只剩 5 点额度时打引子，等于自己判负：必须给出警告。 */
test('信息牌会把压力顶到上限时给出警告', () => {
  const warn = selfHarmWarning({
    cardId: 'information',
    rules: DEFAULT_RULES,
    round: 1,
    pressure: 95,
    pressureCap: 100,
  });
  assert.match(warn, /至少.*6 点压力/);
  assert.match(warn, /95\/100/);
  assert.match(warn, /判负/);
});

test('额度够、免压力或非信息牌都不warning', () => {
  assert.equal(
    selfHarmWarning({
      cardId: 'information',
      rules: DEFAULT_RULES,
      round: 1,
      pressure: 60,
      pressureCap: 100,
    }),
    '',
  );
  assert.equal(
    selfHarmWarning({
      cardId: 'information',
      rules: DEFAULT_RULES,
      round: 1,
      pressure: 99,
      pressureCap: 100,
      freeClues: true,
    }),
    '',
  );
  assert.equal(
    selfHarmWarning({
      cardId: 'strike',
      rules: DEFAULT_RULES,
      round: 1,
      pressure: 99,
      pressureCap: 100,
    }),
    '',
  );
});

/** 房主改过线索压力时，警告要跟着改，不能写死 6。 */
test('警告跟随房主自定义的线索压力', () => {
  const rules = {
    ...DEFAULT_RULES,
    cluePressure: { 1: 9, 2: 12, 3: 18, 4: 24 },
  };
  const warn = selfHarmWarning({
    cardId: 'probe',
    rules,
    round: 2,
    pressure: 90,
    pressureCap: 100,
  });
  assert.match(warn, /14 点压力/);
});
