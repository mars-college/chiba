import { useState, useEffect } from 'react';
import type { LightWithState, LightSchedule, BreakpointTimeType } from '@chiba/shared';
import { apiGet, apiPut, apiDelete } from '../hooks/useApi';

type ColorMode = 'none' | 'color' | 'temperature';

interface BreakpointRow {
  timeType: BreakpointTimeType;
  time: string;
  offsetMinutes: number;
  power: boolean;
  brightness: number;
  colorMode: ColorMode;
  hue: number;
  saturation: number;
  kelvin: number;
}

interface LightScheduleModalProps {
  light: LightWithState;
  onClose: () => void;
}

function rowFromSaved(bp: { timeType: BreakpointTimeType; time?: string; offsetMinutes?: number; power: boolean; brightness: number; hue?: number; saturation?: number; kelvin?: number }): BreakpointRow {
  let colorMode: ColorMode = 'none';
  if (bp.kelvin != null) colorMode = 'temperature';
  else if (bp.hue != null || bp.saturation != null) colorMode = 'color';

  return {
    timeType: bp.timeType,
    time: bp.time || '08:00',
    offsetMinutes: bp.offsetMinutes || 0,
    power: bp.power,
    brightness: bp.brightness,
    colorMode,
    hue: bp.hue ?? 0,
    saturation: bp.saturation ?? 100,
    kelvin: bp.kelvin ?? 4000,
  };
}

export function LightScheduleModal({ light, onClose }: LightScheduleModalProps) {
  const [enabled, setEnabled] = useState(false);
  const [breakpoints, setBreakpoints] = useState<BreakpointRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ success: boolean; data: LightSchedule }>(`/lights/${light.id}/schedule`)
      .then(res => {
        setEnabled(res.data.enabled);
        setBreakpoints(res.data.breakpoints.map(rowFromSaved));
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [light.id]);

  const addBreakpoint = () => {
    setBreakpoints(prev => [
      ...prev,
      { timeType: 'clock', time: '08:00', offsetMinutes: 0, power: true, brightness: 100, colorMode: 'none', hue: 0, saturation: 100, kelvin: 4000 },
    ]);
  };

  const removeBreakpoint = (index: number) => {
    setBreakpoints(prev => prev.filter((_, i) => i !== index));
  };

  const updateBreakpoint = (index: number, updates: Partial<BreakpointRow>) => {
    setBreakpoints(prev =>
      prev.map((bp, i) => (i === index ? { ...bp, ...updates } : bp))
    );
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiPut(`/lights/${light.id}/schedule`, {
        enabled,
        breakpoints: breakpoints.map(bp => ({
          timeType: bp.timeType,
          time: bp.timeType === 'clock' ? bp.time : undefined,
          offsetMinutes: bp.timeType !== 'clock' ? bp.offsetMinutes : undefined,
          power: bp.power,
          brightness: bp.brightness,
          ...(bp.power && bp.colorMode === 'color' && { hue: bp.hue, saturation: bp.saturation }),
          ...(bp.power && bp.colorMode === 'temperature' && { kelvin: bp.kelvin }),
        })),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setSaving(true);
    try {
      await apiDelete(`/lights/${light.id}/schedule`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setSaving(false);
    }
  };

  const labelStyle = { fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' as const };
  const valueStyle = { fontSize: '0.8rem', color: 'var(--text-secondary)', minWidth: '28px', textAlign: 'right' as const };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '560px' }}>
        <div className="modal-header">
          <h2 className="modal-title">Schedule: {light.name}</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        <div className="modal-body">
          {loading ? (
            <div style={{ textAlign: 'center', padding: '24px' }}>
              <div className="loading-spinner" />
            </div>
          ) : (
            <>
              {error && (
                <div className="alert alert-error" style={{ marginBottom: '16px' }}>
                  {error}
                </div>
              )}

              {/* Enable/disable toggle */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '16px',
                padding: '8px 0',
              }}>
                <span style={{ fontWeight: 500 }}>Schedule enabled</span>
                <label style={{
                  position: 'relative',
                  display: 'inline-block',
                  width: '44px',
                  height: '24px',
                  cursor: 'pointer',
                }}>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={e => setEnabled(e.target.checked)}
                    style={{ opacity: 0, width: 0, height: 0 }}
                  />
                  <span style={{
                    position: 'absolute',
                    inset: 0,
                    borderRadius: '12px',
                    background: enabled ? 'var(--color-primary)' : '#555',
                    transition: 'background 0.2s',
                  }}>
                    <span style={{
                      position: 'absolute',
                      top: '2px',
                      left: enabled ? '22px' : '2px',
                      width: '20px',
                      height: '20px',
                      borderRadius: '50%',
                      background: 'white',
                      transition: 'left 0.2s',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                    }} />
                  </span>
                </label>
              </div>

              {/* Breakpoints list */}
              <div style={{ marginBottom: '16px' }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '8px',
                }}>
                  <span style={{ fontWeight: 500, fontSize: '0.9rem' }}>
                    Breakpoints ({breakpoints.length})
                  </span>
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={addBreakpoint}
                  >
                    + Add
                  </button>
                </div>

                {breakpoints.length === 0 && (
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', textAlign: 'center', padding: '16px' }}>
                    No breakpoints. Add one to set power/brightness at a specific time.
                  </p>
                )}

                {breakpoints.map((bp, i) => (
                  <div
                    key={i}
                    style={{
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      padding: '12px',
                      marginBottom: '8px',
                      background: 'var(--bg-secondary)',
                    }}
                  >
                    {/* Row 1: Time type + time value + delete */}
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                      <select
                        value={bp.timeType}
                        onChange={e => updateBreakpoint(i, { timeType: e.target.value as BreakpointTimeType })}
                        style={{
                          padding: '4px 8px',
                          borderRadius: '4px',
                          border: '1px solid var(--border-color)',
                          background: 'var(--bg-primary)',
                          color: 'var(--text-primary)',
                          fontSize: '0.85rem',
                        }}
                      >
                        <option value="clock">Clock</option>
                        <option value="sunrise">Sunrise</option>
                        <option value="sunset">Sunset</option>
                      </select>

                      {bp.timeType === 'clock' ? (
                        <input
                          type="time"
                          value={bp.time}
                          onChange={e => updateBreakpoint(i, { time: e.target.value })}
                          style={{
                            padding: '4px 8px',
                            borderRadius: '4px',
                            border: '1px solid var(--border-color)',
                            background: 'var(--bg-primary)',
                            color: 'var(--text-primary)',
                            fontSize: '0.85rem',
                            flex: 1,
                          }}
                        />
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1 }}>
                          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                            {bp.timeType === 'sunrise' ? 'Sunrise' : 'Sunset'}
                          </span>
                          <input
                            type="number"
                            value={bp.offsetMinutes}
                            onChange={e => updateBreakpoint(i, { offsetMinutes: Number(e.target.value) })}
                            style={{
                              width: '60px',
                              padding: '4px 6px',
                              borderRadius: '4px',
                              border: '1px solid var(--border-color)',
                              background: 'var(--bg-primary)',
                              color: 'var(--text-primary)',
                              fontSize: '0.85rem',
                              textAlign: 'center',
                            }}
                          />
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>min</span>
                        </div>
                      )}

                      <button
                        onClick={() => removeBreakpoint(i)}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          color: 'var(--error)',
                          fontSize: '1.2rem',
                          padding: '0 4px',
                          lineHeight: 1,
                        }}
                        title="Remove breakpoint"
                      >
                        &times;
                      </button>
                    </div>

                    {/* Row 2: Power + brightness */}
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: bp.power ? '8px' : '0' }}>
                      <label style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '0.85rem',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}>
                        <input
                          type="checkbox"
                          checked={bp.power}
                          onChange={e => updateBreakpoint(i, { power: e.target.checked })}
                        />
                        Power
                      </label>

                      {bp.power && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1 }}>
                          <span style={labelStyle}>Brightness</span>
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={bp.brightness}
                            onChange={e => updateBreakpoint(i, { brightness: Number(e.target.value) })}
                            style={{ flex: 1 }}
                          />
                          <span style={valueStyle}>{bp.brightness}%</span>
                        </div>
                      )}
                    </div>

                    {/* Row 3: Optional color/temperature */}
                    {bp.power && (
                      <div>
                        {/* Color mode selector */}
                        <div style={{ display: 'flex', gap: '0', marginBottom: bp.colorMode !== 'none' ? '8px' : '0', borderRadius: '4px', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                          {(['none', 'color', 'temperature'] as ColorMode[]).map(m => (
                            <button
                              key={m}
                              onClick={() => updateBreakpoint(i, { colorMode: m })}
                              style={{
                                flex: 1,
                                padding: '3px 8px',
                                border: 'none',
                                background: bp.colorMode === m ? 'var(--color-primary)' : 'var(--bg-primary)',
                                color: bp.colorMode === m ? 'white' : 'var(--text-secondary)',
                                cursor: 'pointer',
                                fontSize: '0.75rem',
                                borderRight: m !== 'temperature' ? '1px solid var(--border-color)' : 'none',
                              }}
                            >
                              {m === 'none' ? 'No color' : m === 'color' ? 'Color' : 'Temp'}
                            </button>
                          ))}
                        </div>

                        {/* Color sliders */}
                        {bp.colorMode === 'color' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ ...labelStyle, minWidth: '32px' }}>Hue</span>
                              <input
                                type="range"
                                min="0"
                                max="360"
                                value={bp.hue}
                                onChange={e => updateBreakpoint(i, { hue: Number(e.target.value) })}
                                style={{
                                  flex: 1,
                                  background: 'linear-gradient(to right, hsl(0,100%,50%), hsl(60,100%,50%), hsl(120,100%,50%), hsl(180,100%,50%), hsl(240,100%,50%), hsl(300,100%,50%), hsl(360,100%,50%))',
                                }}
                              />
                              <span style={valueStyle}>{bp.hue}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ ...labelStyle, minWidth: '32px' }}>Sat</span>
                              <input
                                type="range"
                                min="0"
                                max="100"
                                value={bp.saturation}
                                onChange={e => updateBreakpoint(i, { saturation: Number(e.target.value) })}
                                style={{ flex: 1 }}
                              />
                              <span style={valueStyle}>{bp.saturation}%</span>
                            </div>
                          </div>
                        )}

                        {/* Temperature slider */}
                        {bp.colorMode === 'temperature' && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={labelStyle}>Temp</span>
                            <input
                              type="range"
                              min="2000"
                              max="9000"
                              step="100"
                              value={bp.kelvin}
                              onChange={e => updateBreakpoint(i, { kelvin: Number(e.target.value) })}
                              style={{
                                flex: 1,
                                background: 'linear-gradient(to right, #ff9329, #fff5e6, #ffffff, #d4e4ff, #a6c8ff)',
                              }}
                            />
                            <span style={valueStyle}>{bp.kelvin}K</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          {breakpoints.length > 0 && (
            <button
              className="btn btn-sm"
              onClick={handleDelete}
              disabled={saving}
              style={{ marginRight: 'auto', backgroundColor: 'var(--error)', color: 'white' }}
            >
              Delete Schedule
            </button>
          )}
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || loading}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
