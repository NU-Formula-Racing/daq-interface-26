import { useState } from 'react';
import { getGgSource, setGgSource, ggSignalNames, type GgSource } from '@nfr/widgets';

/** Lets the user choose which IMU signal pair feeds every g-g plot.
 *  Preference lives in localStorage and is read by GgPlotWidget at
 *  render time, so flipping this rebinds open widgets immediately. */
export function GgPlotSource() {
  const [src, setSrc] = useState<GgSource>(() => getGgSource());
  const choose = (next: GgSource) => {
    setGgSource(next);
    setSrc(next);
  };
  const [rawX, rawY] = ggSignalNames('raw');
  const [noGX, noGY] = ggSignalNames('no-g');
  return (
    <fieldset className="border border-[color:var(--color-border)] p-4 space-y-3">
      <legend className="px-2 text-[10px] tracking-widest text-[color:var(--color-text-mute)] uppercase">
        G-G plot source
      </legend>
      <p className="text-[11px] text-[color:var(--color-text-mute)]">
        Which IMU acceleration pair feeds every g-g plot widget on the dock.
        The default uses the raw signals (with gravity); switch to the no-G
        signals if you'd rather see lateral / longitudinal acceleration with
        gravity already subtracted.
      </p>
      <div className="flex flex-col gap-2 text-[11px]">
        <label className="inline-flex items-start gap-2 cursor-pointer">
          <input
            type="radio"
            name="gg-source"
            checked={src === 'raw'}
            onChange={() => choose('raw')}
            className="mt-[3px]"
          />
          <span>
            <strong>With gravity</strong> —{' '}
            <code>{rawX}</code> · <code>{rawY}</code>
          </span>
        </label>
        <label className="inline-flex items-start gap-2 cursor-pointer">
          <input
            type="radio"
            name="gg-source"
            checked={src === 'no-g'}
            onChange={() => choose('no-g')}
            className="mt-[3px]"
          />
          <span>
            <strong>No-G</strong> —{' '}
            <code>{noGX}</code> · <code>{noGY}</code>
          </span>
        </label>
      </div>
    </fieldset>
  );
}
