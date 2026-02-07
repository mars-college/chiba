import { useState, useEffect } from 'react';
import type { PlugWithState, PlugSchedule, BreakpointTimeType } from '@chiba/shared';
import { apiGet, apiPut, apiDelete } from '../hooks/useApi';

interface BreakpointRow {
  timeType: BreakpointTimeType;
  time: string;
  offsetMinutes: number;
  power: boolean;
}

interface PlugScheduleModalProps {
  plug: PlugWithState;
  onClose: () => void;
}

function rowFromSaved(bp: { timeType: BreakpointTimeType; time?: string; offsetMinutes?: number; power: boolean }): BreakpointRow {
  return {
    timeType: bp.timeType,
    time: bp.time || '08:00',
    offsetMinutes: bp.offsetMinutes || 0,
    power: bp.power,
  };
}

export function PlugScheduleModal({ plug, onClose }: PlugScheduleModalProps) {
  const [enabled, setEnabled] = useState(false);
  const [breakpoints, setBreakpoints] = useState<BreakpointRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ success: boolean; data: PlugSchedule }>(`/plugs/${plug.id}/schedule`)
      .then(res => {
        setEnabled(res.data.enabled);
        setBreakpoints(res.data.breakpoints.map(rowFromSaved));
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [plug.id]);

  const addBreakpoint = () => {
    setBreakpoints(prev => [
      ...prev,
      { timeType: 'clock', time: '08:00', offsetMinutes: 0, power: true },
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
      await apiPut(`/plugs/${plug.id}/schedule`, {
        enabled,
        breakpoints: breakpoints.map(bp => ({
          timeType: bp.timeType,
          time: bp.timeType === 'clock' ? bp.time : undefined,
          offsetMinutes: bp.timeType !== 'clock' ? bp.offsetMinutes : undefined,
          power: bp.power,
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
      await apiDelete(`/plugs/${plug.id}/schedule`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '480px' }}>
        <div className="modal-header">
          <h2 className="modal-title">Schedule: {plug.name}</h2>
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
                    No breakpoints. Add one to set power on/off at a specific time.
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

                    {/* Row 2: Power toggle */}
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
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
                        Power {bp.power ? 'On' : 'Off'}
                      </label>
                    </div>
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
