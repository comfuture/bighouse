/** true is the flat underside; the marked first stick alone has a small red dot. */
export function stickFaceMarkup(flat: boolean, index: number): string {
  return flat ? index === 0 ? '<span class="yut-backdo-dot" aria-hidden="true"></span>' : ""
    : '<span class="yut-stick-crosses" aria-hidden="true"><i>×</i><i>×</i><i>×</i></span>';
}
