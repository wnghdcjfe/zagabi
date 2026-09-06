'use strict';

// 2816 디지털 티비 — 조작열이 유일하지 않다.
// 지문 samples[1] 과 samples[2] 가 같은 입력에 `11144411144` 와 `33144413` 을 둘 다 정답으로 제시한다.
// 게다가 "화살표가 범위를 넘어가면 그 명령은 무시한다" 라서 어떤 정답 열에도 무시되는 버튼을
// 끼워 넣을 수 있다. 출력이 유일해지는 입력이 아예 존재하지 않는다.
//
// 그래서 기대 출력과 비교하지 않고, 조작열을 실제로 시뮬레이션해 최종 상태만 검사한다.

const { fail, pass, tokenize, toInteger } = require('./utils');

const MAX_BUTTON_COUNT = 500;

function check({ input, stdout }) {
  const inputTokens = tokenize(input);
  const size = toInteger(inputTokens[0]);
  if (size === null) {
    throw new Error('2816 input must start with an integer');
  }
  const channels = inputTokens.slice(1, size + 1);
  if (channels.length !== size) {
    throw new Error('2816 input must contain N channel names');
  }

  const tokens = tokenize(stdout);
  if (tokens.length === 0) {
    return fail('empty_output', '출력이 비어 있습니다.');
  }
  if (tokens.length > 1) {
    return fail('extra_output', '버튼은 공백 없이 한 줄로 출력해야 합니다.');
  }

  const buttons = tokens[0];
  // 지문: "방법의 길이는 500보다 작아야 한다".
  if (buttons.length >= MAX_BUTTON_COUNT) {
    return fail('too_long', `버튼 수는 ${MAX_BUTTON_COUNT}개보다 적어야 하는데 ${buttons.length}개입니다.`);
  }

  const list = [...channels];
  let cursor = 0;

  for (let index = 0; index < buttons.length; index += 1) {
    const button = buttons[index];
    switch (button) {
      case '1':
        // 화살표가 리스트 범위를 넘어가면 그 명령은 무시한다.
        if (cursor + 1 < list.length) cursor += 1;
        break;
      case '2':
        if (cursor > 0) cursor -= 1;
        break;
      case '3':
        if (cursor + 1 < list.length) {
          [list[cursor], list[cursor + 1]] = [list[cursor + 1], list[cursor]];
          cursor += 1;
        }
        break;
      case '4':
        if (cursor > 0) {
          [list[cursor], list[cursor - 1]] = [list[cursor - 1], list[cursor]];
          cursor -= 1;
        }
        break;
      default:
        return fail('invalid_button', `${index + 1}번째 문자가 1~4 버튼이 아닙니다.`);
    }
  }

  if (list[0] !== 'KBS1') {
    return fail('bad_final_state', '조작을 마친 뒤 KBS1 이 첫 번째가 아닙니다.');
  }
  if (list[1] !== 'KBS2') {
    return fail('bad_final_state', '조작을 마친 뒤 KBS2 가 두 번째가 아닙니다.');
  }

  return pass();
}

module.exports = { check };
