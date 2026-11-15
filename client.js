/**
 * Thinking-effort slider, merged into the composer's model trigger.
 *
 * The control renders through `conversation.input.model.label`, which the shipped
 * model seat draws INSIDE its own trigger button. The result is one control —
 * slider, then the seat's own chevron — where dragging the slider changes the
 * level and clicking the trigger (or its chevron) opens the original model menu,
 * including model search, provider groups and the Agent Teams switch.
 *
 * Data and submission ride the same per-session `ModelDirectory` the menu uses,
 * so a drag and a menu pick always agree.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-effort-slider',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React;

    /** Per-model memory: `provider/model` -> last effort id chosen for it. */
    const STORAGE_KEY = 'dsh.effort-slider.remember.v1';

    /** Snapshot used while no Session directory is resolvable. */
    const EMPTY_STATE = Object.freeze({
      current: null,
      retainedEffort: undefined,
      routable: null,
      groups: [],
      failures: [],
      status: 'idle',
      pending: null,
      error: null,
    });

    /* Geometry is derived from one pair of numbers: a knob that almost fills the
       track, inset by a single pixel of track border on every side. */
    const TRACK_H = 26;
    const THUMB = 24;
    const RAIL = TRACK_H - 2;
    const TRACK_W = 108;
    const INSET = THUMB / 2;
    /* Fixed caption slot: a widening level name must not move the track. */
    const LABEL_W = 30;

    const CSS = `
.desl{display:inline-flex;align-items:center;vertical-align:middle;line-height:0;margin:0 2px;user-select:none;-webkit-user-select:none;cursor:default}
.desl[data-busy="true"]{pointer-events:none}
.desl__name{flex:0 0 ${LABEL_W}px;width:${LABEL_W}px;text-align:right;overflow:hidden;text-overflow:ellipsis;font-size:11px;line-height:1;margin-right:7px;color:var(--dsw-alias-label-secondary);white-space:nowrap;font-variant-numeric:tabular-nums}
.desl__track{position:relative;width:${TRACK_W}px;height:${TRACK_H}px;border-radius:999px;corner-shape:round;background:var(--dsw-alias-bg-layer-2);box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l1),inset 0 1px 2px rgba(0,0,0,.045);touch-action:none;isolation:isolate}
.desl__rail{position:absolute;left:0;right:0;top:1px;height:${RAIL}px;border-radius:999px;corner-shape:round;overflow:hidden;pointer-events:none}
.desl__fill{position:absolute;left:0;top:0;height:100%;border-radius:999px 0 0 999px;background-color:var(--dsw-alias-button-info-fill,#4176e6);background-repeat:no-repeat;background-size:${TRACK_W}px ${RAIL}px;transition:width 180ms cubic-bezier(.22,1,.36,1),background-color 180ms ease}
.desl[data-max="true"] .desl__fill{background-color:transparent;background-image:linear-gradient(90deg,var(--dsw-alias-button-info-fill,#4176e6) 0%,#6a4bf0 60%,#8b5cf6 100%)}
.desl__dot{position:absolute;top:50%;width:3px;height:3px;margin:-1.5px 0 0 -1.5px;border-radius:50%;background:#fff;opacity:.78;pointer-events:none;transition:opacity 160ms ease}
.desl__dot[data-on="false"]{background:var(--dsw-alias-label-secondary);opacity:.34}
.desl__thumb{position:absolute;top:50%;width:${THUMB}px;height:${THUMB}px;margin-top:-${THUMB / 2}px;border-radius:50%;corner-shape:round;box-sizing:border-box;background:#fff;box-shadow:inset 0 0 0 1px rgba(16,24,40,.14),0 1px 3px rgba(16,24,40,.16);transform:translateX(-50%);transition:left 180ms cubic-bezier(.22,1,.36,1),box-shadow 160ms ease;pointer-events:none}
.desl:hover .desl__thumb{box-shadow:inset 0 0 0 1px rgba(16,24,40,.16),0 1px 4px rgba(16,24,40,.22)}
.desl[data-pressing="true"] .desl__fill,
.desl[data-pressing="true"] .desl__thumb{transition:none}
.desl[data-failed="true"] .desl__fill{background-color:var(--dsw-alias-state-error-primary);background-image:none}
.desl[data-failed="true"] .desl__thumb{box-shadow:0 0 0 2px var(--dsw-alias-state-error-primary),0 1px 2px rgba(0,0,0,.16)}
/* The trigger draws its own effort caption after the label slot. The level now
   lives on the slider's left, so that caption would read twice. Scoped to a
   trigger that actually hosts the slider: a model without levels keeps it. */
[data-slot="conversation.input.model"] button:has(.desl) > span:has(.desl) + span{display:none}
/* Tighten the seat for the slider: its stock padding-left, leading glyph and
   gap were sized for a text label, and would leave an empty pocket here. */
[data-slot="conversation.input.model"] button:has(.desl){padding-left:4px;gap:2px}
[data-slot="conversation.input.model"] button:has(.desl) > svg:first-child{display:none}
`;

    /** @returns {Record<string, string>} remembered effort ids. */
    function readMemory() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        const parsed = raw === null ? null : JSON.parse(raw);
        return parsed !== null && typeof parsed === 'object' ? parsed : {};
      } catch {
        return {};
      }
    }

    /** @param {Record<string, string>} next - complete memory to persist. */
    function writeMemory(next) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* private mode or quota: memory is a convenience, not state of record */
      }
    }

    /**
     * Read the current model's reasoning metadata from one directory snapshot.
     * @param {object} state - ModelDirectoryState.
     * @returns {{efforts: readonly object[], defaultEffort?: string}|null}
     */
    function reasoningOf(state) {
      if (state === null || state.current === null || state.current === undefined) return null;
      const group = state.groups.find(entry => entry.id === state.current.provider);
      const model = group === undefined
        ? undefined
        : group.models.find(entry => entry.id === state.current.model);
      const reasoning = model === undefined ? undefined : model.reasoning;
      if (reasoning === undefined || reasoning === null || reasoning.efforts.length === 0) return null;
      return reasoning;
    }

    /**
     * The slider cell. Rendering inside the model trigger means every pointer
     * event must be swallowed, or the button would open the menu mid-drag.
     * @param {object} props - label-slot props plus `ctx` and `t`.
     * @returns {React.ReactElement|null}
     */
    function EffortSlider(props) {
      const { sessionId, placement, model: ownerModel, ctx, t } = props;

      const directory = useMemo(() => {
        if (ctx === null || ctx === undefined || sessionId === undefined) return null;
        let resolver;
        try {
          resolver = ctx.get('modelDirectories');
        } catch {
          return null;
        }
        if (resolver === undefined || resolver === null) return null;
        try {
          return resolver.directoryFor(sessionId);
        } catch {
          /* addressed subagent Sessions have no model selection */
          return null;
        }
      }, [ctx, sessionId]);

      const subscribe = useCallback(
        listener => (directory === null ? () => {} : directory.store.subscribe(listener)),
        [directory],
      );
      const getSnapshot = useCallback(
        () => (directory === null ? EMPTY_STATE : directory.store.getSnapshot()),
        [directory],
      );
      const state = useSyncExternalStore(subscribe, getSnapshot);

      const trackRef = useRef(null);
      const downRef = useRef(false);
      const failTimer = useRef(0);
      const settleTimer = useRef(0);
      /** Index the pointer holds optimistically until the Host confirms it. */
      const [held, setHeld] = useState(null);
      const [pressing, setPressing] = useState(false);
      const [failed, setFailed] = useState(false);

      useEffect(() => () => {
        window.clearTimeout(failTimer.current);
        window.clearTimeout(settleTimer.current);
      }, []);

      const notifyFailure = () => {
        setFailed(true);
        window.clearTimeout(failTimer.current);
        failTimer.current = window.setTimeout(() => { setFailed(false); }, 1600);
      };

      useEffect(() => {
        if (directory === null) return;
        void Promise.resolve(directory.load()).catch(() => {
          /* the shared directory store carries the load failure */
        });
      }, [directory]);

      const reasoning = reasoningOf(state);
      const efforts = reasoning === null ? [] : reasoning.efforts;
      const effective = state.current === null || state.current === undefined
        ? undefined
        : state.current.reasoningEffort ?? reasoning?.defaultEffort;
      let selected = efforts.findIndex(level => level.id === effective);
      if (selected < 0) selected = 0;
      const busy = state.pending !== null || state.status === 'selecting';
      const shown = held === null ? selected : Math.min(held, efforts.length - 1);

      // Release the optimistic index as soon as the Host reports that level, so
      // the knob never springs back to the previous stop after a click.
      useEffect(() => {
        if (held === null) return;
        const level = efforts[held];
        if (level === undefined || level.id === effective) {
          window.clearTimeout(settleTimer.current);
          setHeld(null);
        }
      }, [held, effective, efforts]);

      const commit = useCallback(index => {
        if (directory === null || state.current === null || state.current === undefined) return;
        const level = efforts[index];
        if (level === undefined) return;
        const { provider, model } = state.current;
        const memory = readMemory();
        memory[`${provider}/${model}`] = level.id;
        writeMemory(memory);
        window.clearTimeout(settleTimer.current);
        settleTimer.current = window.setTimeout(() => { setHeld(null); }, 4000);
        try {
          const result = directory.select({ provider, model, reasoningEffort: level.id });
          if (result !== undefined && result !== null && typeof result.then === 'function') {
            result.then(outcome => {
              if (outcome !== undefined && outcome.ok === false) {
                notifyFailure();
                setHeld(null);
              }
            }, () => {
              notifyFailure();
              setHeld(null);
            });
          }
        } catch {
          setHeld(null);
        }
      }, [directory, state.current, efforts]);

      // Per-model memory: restore this model's last level once after it becomes current.
      const restored = useRef('');
      useEffect(() => {
        if (directory === null || reasoning === null) return;
        if (state.status !== 'ready' || state.pending !== null) return;
        if (state.current === null || state.current === undefined) return;
        const { provider, model } = state.current;
        const remembered = readMemory()[`${provider}/${model}`];
        if (remembered === undefined) return;
        if (remembered === effective) return;
        if (efforts.findIndex(level => level.id === remembered) < 0) return;
        const stamp = `${provider}/${model}=${remembered}`;
        if (restored.current === stamp) return;
        restored.current = stamp;
        try {
          const result = directory.select({ provider, model, reasoningEffort: remembered });
          if (result !== undefined && result !== null && typeof result.then === 'function') {
            result.then(() => {}, () => {});
          }
        } catch {
          /* keep the Host's current selection */
        }
      }, [directory, reasoning, state.status, state.pending, state.current, effective, efforts]);

      const offsetOf = index => {
        const ratio = efforts.length < 2 ? 1 : index / (efforts.length - 1);
        return `calc(${INSET}px + (100% - ${INSET * 2}px) * ${ratio})`;
      };

      const indexAt = clientX => {
        const node = trackRef.current;
        if (node === null) return 0;
        const rect = node.getBoundingClientRect();
        const span = rect.width - INSET * 2;
        if (span <= 0) return 0;
        const ratio = Math.min(1, Math.max(0, (clientX - rect.left - INSET) / span));
        return Math.round(ratio * (efforts.length - 1));
      };

      // The dropdown asks this same slot for a row label; only the trigger gets
      // the slider, so menu rows keep showing the plain model name.
      if (placement !== undefined && placement !== 'trigger') {
        return h('span', null, ownerModel === undefined ? '' : ownerModel.name);
      }

      // One level (or none) is not a choice: leave the shipped trigger alone.
      if (directory === null || reasoning === null || efforts.length < 2) return null;

      const stop = event => {
        event.preventDefault();
        event.stopPropagation();
      };

      const current = efforts[shown];
      const valueText = current === undefined
        ? ''
        : current.description === undefined ? current.name : `${current.name} — ${current.description}`;

      const onKeyDown = event => {
        if (busy) return;
        let next = null;
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = Math.min(efforts.length - 1, shown + 1);
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = Math.max(0, shown - 1);
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = efforts.length - 1;
        if (next === null) return;
        event.preventDefault();
        event.stopPropagation();
        setHeld(next);
        commit(next);
      };

      return h('span', {
        className: 'desl',
        role: 'slider',
        'aria-label': t('label'),
        'aria-valuemin': 0,
        'aria-valuemax': Math.max(0, efforts.length - 1),
        'aria-valuenow': shown,
        'aria-valuetext': valueText,
        'aria-disabled': busy ? 'true' : undefined,
        title: valueText,
        'data-busy': busy ? 'true' : undefined,
        'data-pressing': pressing ? 'true' : undefined,
        'data-max': shown === efforts.length - 1 ? 'true' : undefined,
        'data-failed': failed ? 'true' : undefined,
        onKeyDown,
        onClick: stop,
        onPointerDown: event => {
          event.preventDefault();
          event.stopPropagation();
          if (busy || (event.button !== 0 && event.pointerType === 'mouse')) return;
          const node = trackRef.current;
          if (node !== null) node.setPointerCapture(event.pointerId);
          downRef.current = true;
          setPressing(true);
          setHeld(indexAt(event.clientX));
        },
        onPointerMove: event => {
          if (!downRef.current) return;
          event.stopPropagation();
          setHeld(indexAt(event.clientX));
        },
        onPointerUp: event => {
          if (!downRef.current) return;
          event.stopPropagation();
          downRef.current = false;
          setPressing(false);
          const node = trackRef.current;
          if (node !== null) {
            try {
              node.releasePointerCapture(event.pointerId);
            } catch {
              /* capture already released */
            }
          }
          const index = indexAt(event.clientX);
          setHeld(index);
          commit(index);
        },
        onPointerCancel: () => {
          downRef.current = false;
          setPressing(false);
          setHeld(null);
        },
      },
      h('span', { className: 'desl__name', 'aria-hidden': true }, current === undefined ? '' : current.name),
      h('span', { ref: trackRef, className: 'desl__track' },
        h('span', { className: 'desl__rail' },
          h('span', { className: 'desl__fill', style: { width: offsetOf(shown) } })),
        ...efforts.map((level, index) => h('i', {
          key: `dot-${level.id}`,
          className: 'desl__dot',
          'data-on': index <= shown ? 'true' : 'false',
          style: { left: offsetOf(index) },
          'aria-hidden': true,
        })),
        h('i', { className: 'desl__thumb', style: { left: offsetOf(shown) }, 'aria-hidden': true })));
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => {
          const element = document.createElement('style');
          element.setAttribute('data-dsh-plugin', '@local/dsh-effort-slider');
          element.textContent = CSS;
          document.head.appendChild(element);
          return () => { element.remove(); };
        }, 'dsh-effort-slider: styles');

        ctx.effect(() => {
          const disposers = [
            ctx.locale.register('effort-slider', 'en', { label: 'Thinking effort' }),
            ctx.locale.register('effort-slider', 'zh', { label: '思考强度' }),
          ];
          return () => {
            for (const dispose of disposers) dispose();
          };
        }, 'dsh-effort-slider: locale');

        const t = ctx.locale.bind('effort-slider');

        ctx.slots.inject('conversation.input.model.label', () => ctx.slots.register({
          name: 'conversation.input.model.label',
        }, props => h(EffortSlider, { ...props, ctx, t })));
      },
    };
  },
});
