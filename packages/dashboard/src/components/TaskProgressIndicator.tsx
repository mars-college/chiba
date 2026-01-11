import type { TaskProgress } from '../hooks/useWebSocket';

interface TaskProgressIndicatorProps {
  tasks: Map<string, TaskProgress>;
  nodeId?: string;  // Filter to show only tasks for a specific node
}

/**
 * Shows active download/cache tasks with progress.
 */
export function TaskProgressIndicator({ tasks, nodeId }: TaskProgressIndicatorProps) {
  // Filter tasks if nodeId is provided
  const filteredTasks = nodeId
    ? Array.from(tasks.values()).filter(t => t.nodeId === nodeId)
    : Array.from(tasks.values());

  // Sort: in-progress first, then by receivedAt
  const sortedTasks = filteredTasks.sort((a, b) => {
    const aActive = a.status !== 'completed' && a.status !== 'error';
    const bActive = b.status !== 'completed' && b.status !== 'error';
    if (aActive && !bActive) return -1;
    if (!aActive && bActive) return 1;
    return b.receivedAt - a.receivedAt;
  });

  if (sortedTasks.length === 0) {
    return null;
  }

  return (
    <div className="task-progress-container">
      {sortedTasks.map(task => (
        <TaskProgressItem key={task.taskId} task={task} />
      ))}
    </div>
  );
}

function TaskProgressItem({ task }: { task: TaskProgress }) {
  const statusClass =
    task.status === 'completed' ? 'task-completed' :
    task.status === 'error' ? 'task-error' :
    task.status === 'downloading' || task.status === 'processing' ? 'task-active' :
    'task-queued';

  const statusIcon =
    task.status === 'completed' ? (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    ) : task.status === 'error' ? (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    ) : (
      <svg className="task-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
        <path d="M21 12a9 9 0 11-6.219-8.56" />
      </svg>
    );

  const taskTypeLabel =
    task.taskType === 'youtube' ? 'YouTube' :
    task.taskType === 'eden' ? 'Eden' :
    'Download';

  return (
    <div className={`task-progress-item ${statusClass}`}>
      <div className="task-progress-header">
        <span className="task-icon">{statusIcon}</span>
        <span className="task-type">{taskTypeLabel}</span>
        <span className="task-status">{task.message || task.status}</span>
      </div>
      {task.status === 'downloading' && (
        <div className="task-progress-bar-container">
          <div
            className="task-progress-bar"
            style={{ width: `${Math.min(100, Math.max(0, task.progress))}%` }}
          />
        </div>
      )}
      {task.error && (
        <div className="task-error-message">
          {task.error.message}
        </div>
      )}
    </div>
  );
}
