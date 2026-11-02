import type { JSX } from 'preact';

export function PasturePracticeScene(): JSX.Element {
  return (
    <div class="connect-scene" role="img" aria-label="Animated practice scene showing an archer, a cow target, and a virtual trade result. No real bet is placed.">
      <div class="practice-scene-label">PRACTICE <span>NO REAL BET</span></div>
      <div class="practice-market"><strong>VOL 100 · OVER 1</strong><span>$1.00 virtual</span><div class="practice-health"><i /></div></div>
      <div class="practice-balance" aria-hidden="true"><small>VIRTUAL BALANCE</small><strong class="practice-balance-before">$25.00</strong><strong class="practice-balance-after">$25.80</strong></div>
      <div class="practice-miss" aria-hidden="true">MISS</div>
      <div class="practice-result practice-open" aria-hidden="true"><small>VIRTUAL TRADE</small><strong>Digit 6 · Open</strong></div>
      <div class="practice-result practice-win" aria-hidden="true"><small>VIRTUAL RESULT</small><strong>Won +$0.80</strong></div>
      <svg class="connect-scene-art" viewBox="0 0 500 240" aria-hidden="true">
        <ellipse cx="310" cy="216" rx="140" ry="13" fill="#244e2b" opacity=".38" />
        <g class="practice-ranger"><ellipse cx="62" cy="218" rx="29" ry="7" fill="#244e2b" opacity=".35"/><path d="M44 175v35h13v-35m12 0v35h13v-35" fill="#393a3d" stroke="#28332f" stroke-width="3"/><path d="M40 205h20v9H40zm29 0h20v9H69z" fill="#5d4530"/><path d="M40 114h45l3 66H39z" fill="#326db1" stroke="#224470" stroke-width="4"/><path d="M40 165h47v7H40z" fill="#866338"/><path d="M37 111 27 82 16 100l8 24" fill="#7c4934"/><circle cx="63" cy="93" r="22" fill="#cba17d"/><path d="M41 88q2-24 22-24t22 22l-12-10-16 8z" fill="#4d3729"/><circle cx="65" cy="92" r="2" fill="#271f1d"/><circle cx="75" cy="92" r="2" fill="#271f1d"/><path d="M45 126 61 137l19-12M80 125l24-4" fill="none" stroke="#c69b75" stroke-width="9" stroke-linecap="round"/><g class="practice-bow"><path d="M101 93q30 26 0 58" fill="none" stroke="#925d32" stroke-width="6" stroke-linecap="round"/><path d="M101 93v58" fill="none" stroke="#fff0cb" stroke-width="2"/></g></g>
        <g transform="translate(0 35) scale(1.35)"><g class="connect-scene-cow">
          <path d="M157 97 147 133h17l7-31m75-1 5 32h17l-3-46" fill="#e4c99f" stroke="#553524" stroke-width="4" stroke-linejoin="round" />
          <path d="M144 71q-24 4-26 27-2 9-11 8" fill="none" stroke="#f4dfb6" stroke-width="6" stroke-linecap="round" />
          <ellipse cx="210" cy="76" rx="71" ry="46" fill="#fff0cb" stroke="#553524" stroke-width="4" />
          <path d="M170 41q-22 17-17 46l19 11 16-16-5-19 10-13zM238 36q22 8 32 25l-7 30-20 6-11-17 9-20z" fill="#895238" />
          <circle cx="203" cy="75" r="24" fill="#ed3544" /><circle cx="203" cy="75" r="15" fill="#fff1cf" /><circle cx="203" cy="75" r="7" fill="#ed3544" />
          <path d="M267 45 256 23l25 10m21 10 13-18-3 27" fill="#bd875a" stroke="#553524" stroke-width="3" stroke-linejoin="round" />
          <path d="M255 54q16-27 40-18 27 11 28 37l-12 28h-46q-20-10-10-47z" fill="#fff0cb" stroke="#553524" stroke-width="4" />
          <g class="practice-eyes"><circle cx="281" cy="61" r="4" fill="#39271d" /><circle cx="307" cy="62" r="4" fill="#39271d" /></g><g class="practice-dead-eyes" fill="none" stroke="#39271d" stroke-width="3" stroke-linecap="round"><path d="m277 57 8 8m0-8-8 8m26-7 8 8m0-8-8 8" /></g>
          <ellipse cx="298" cy="89" rx="26" ry="16" fill="#f49691" stroke="#a7625a" stroke-width="2" /><circle cx="289" cy="89" r="3" fill="#8b514b" /><circle cx="307" cy="89" r="3" fill="#8b514b" />
        </g></g>
        {[1, 2, 3, 4].map((shot) => <g class={`practice-arrow shot-${shot}`} key={shot}><path d="M0 0h52" stroke="#543624" stroke-width="4" stroke-linecap="round"/><path d="m52 0-12-7v14z" fill="#e92b43"/><path d="M11 0 2-7H-8L0 0l-8 7H2z" fill="#e92b43"/></g>)}
      </svg>
    </div>
  );
}
