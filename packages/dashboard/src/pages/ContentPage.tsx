import { useState, useEffect, useRef, useCallback } from 'react';
import type { Content, NodeStatus } from '@chiba/shared';
import { apiGet, apiPost, apiPut, apiDelete, apiUpload, UploadProgress } from '../hooks/useApi';

const ALLOWED_FILE_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

export function ContentPage() {
  const [content, setContent] = useState<Content[]>([]);
  const [nodes, setNodes] = useState<NodeStatus[]>([]);
  const [loading, setLoading] = useState(true);

  // Pagination and search state
  const [page, setPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'url' | 'upload'>('url');
  const [urlInput, setUrlInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [descriptionInput, setDescriptionInput] = useState('');
  const [authorInput, setAuthorInput] = useState('');
  const [showDescription, setShowDescription] = useState(false);
  const [adding, setAdding] = useState(false);
  const [sendingTo, setSendingTo] = useState<{ contentId: string; nodeId: string } | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [selectedContent, setSelectedContent] = useState<Content | null>(null);
  const [sendToContent, setSendToContent] = useState<Content | null>(null); // For "Send to" modal

  // Edit modal state
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editAuthor, setEditAuthor] = useState('');
  const [saving, setSaving] = useState(false);

  // Upload state
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [uploadName, setUploadName] = useState('');
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadAuthor, setUploadAuthor] = useState('');
  const [stagedFile, setStagedFile] = useState<File | null>(null);
  const [stagedPreviewUrl, setStagedPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchNodes();
  }, []);

  useEffect(() => {
    fetchContent();
  }, [page, search]);

  const fetchContent = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '100',
      });
      if (search) {
        params.set('search', search);
      }
      const response = await apiGet<{
        success: boolean;
        data: { items: Content[]; total: number; page: number; limit: number };
      }>(`/content?${params}`);
      setContent(response.data.items || []);
      setTotalItems(response.data.total || 0);
    } catch (err) {
      console.error('Failed to fetch content:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchNodes = async () => {
    try {
      const response = await apiGet<{ success: boolean; data: { nodes: NodeStatus[] } }>('/nodes');
      setNodes(response.data.nodes || []);
    } catch (err) {
      console.error('Failed to fetch nodes:', err);
    }
  };

  const handleSendToNode = async (item: Content, nodeId: string) => {
    const node = nodes.find(n => n.node.id === nodeId);
    if (!node) return;

    setSendingTo({ contentId: item.id, nodeId });
    setMessage(null);
    setSendToContent(null); // Close modal

    try {
      // Get the URL to send - either originalUrl or construct from source
      const url = item.originalUrl || (item.source as { url?: string }).url;
      if (!url) {
        throw new Error('No URL available for this content');
      }

      // Send play command to node which will download and cache
      // Include name so the node can store it with the cached content
      await apiPost(`/nodes/${nodeId}/play`, {
        type: item.source.type,
        url,
        name: item.name, // Pass the friendly name
        loop: false,
      });

      setMessage({
        type: 'success',
        text: `Sent "${item.name || item.filename}" to ${node.node.friendlyName}. It will download and start playing.`
      });
      setTimeout(() => setMessage(null), 5000);
    } catch (err) {
      setMessage({
        type: 'error',
        text: `Failed to send to node: ${(err as Error).message}`
      });
    } finally {
      setSendingTo(null);
    }
  };

  const handleDeleteContent = async (item: Content) => {
    if (!window.confirm(`Delete "${item.name || item.filename}" from the content library?`)) {
      return;
    }

    try {
      await apiDelete(`/content/${item.id}`);
      setMessage({ type: 'success', text: 'Content deleted from library' });
      fetchContent();
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      setMessage({ type: 'error', text: `Failed to delete: ${(err as Error).message}` });
    }
  };

  const handleOpenDetails = (item: Content) => {
    setSelectedContent(item);
    setEditName(item.name || '');
    setEditDescription(item.metadata?.description || '');
    setEditAuthor(item.metadata?.author || '');
  };

  const handleSaveContent = async () => {
    if (!selectedContent) return;

    setSaving(true);
    try {
      await apiPut(`/content/${selectedContent.id}`, {
        name: editName,
        description: editDescription,
        author: editAuthor,
      });
      setMessage({ type: 'success', text: 'Content updated successfully' });
      fetchContent();
      setSelectedContent(null);
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      setMessage({ type: 'error', text: `Failed to update: ${(err as Error).message}` });
    } finally {
      setSaving(false);
    }
  };

  const handleAddContent = async () => {
    if (!urlInput.trim()) return;

    setAdding(true);
    setMessage(null);

    try {
      const input = urlInput.trim();

      interface ContentResponse {
        success: boolean;
        data: {
          type?: 'collection' | 'creation';
          collectionName?: string;
          playlistName?: string;
          contentCount?: number;
          name?: string;
        };
      }

      const response = await apiPost<ContentResponse>('/content', {
        url: input,
        name: nameInput.trim() || undefined,
        description: descriptionInput.trim() || undefined,
        author: authorInput.trim() || undefined,
      });

      // Reset form
      setUrlInput('');
      setNameInput('');
      setDescriptionInput('');
      setAuthorInput('');
      setShowDescription(false);

      // Generate success message based on response
      let successMessage = 'Content added successfully';
      const data = response.data;

      if (data.type === 'collection') {
        successMessage = `Added Eden collection "${data.collectionName || data.playlistName}": ${data.contentCount} items added to library and playlist "${data.playlistName}" created.`;
      } else if (data.type === 'creation') {
        successMessage = `Eden creation "${data.name}" added to library.`;
      } else if (input.includes('youtube.com') || input.includes('youtu.be')) {
        successMessage = 'YouTube video added. It will be downloaded when played on a node.';
      }

      setMessage({ type: 'success', text: successMessage });
      fetchContent();
      setTimeout(() => setMessage(null), 8000); // Longer timeout for collection messages
    } catch (err) {
      console.error('Failed to add content:', err);
      setMessage({ type: 'error', text: `Failed to add content: ${(err as Error).message}` });
    } finally {
      setAdding(false);
    }
  };

  // File upload handlers - stage file for preview before adding
  const handleStageFile = useCallback((file: File) => {
    // Validate file type
    if (!ALLOWED_FILE_TYPES.includes(file.type)) {
      setMessage({
        type: 'error',
        text: `Unsupported file type: ${file.type}. Allowed: MP4, WebM, MOV, JPEG, PNG, GIF, WebP`,
      });
      return;
    }

    // Clean up previous preview URL
    if (stagedPreviewUrl) {
      URL.revokeObjectURL(stagedPreviewUrl);
    }

    // Stage the file and create preview URL
    setStagedFile(file);
    setStagedPreviewUrl(URL.createObjectURL(file));
    setUploadName(file.name.replace(/\.[^/.]+$/, '')); // Default name from filename without extension
    setUploadDescription('');
    setUploadAuthor('');
    setMessage(null);
  }, [stagedPreviewUrl]);

  // Actually upload and add the staged file to library
  const handleAddUpload = useCallback(async () => {
    if (!stagedFile) return;

    setUploading(true);
    setUploadProgress(null);
    setMessage(null);

    try {
      const result = await apiUpload(
        stagedFile,
        uploadName.trim() || stagedFile.name,
        (progress) => setUploadProgress(progress),
        uploadDescription.trim() || undefined,
        uploadAuthor.trim() || undefined
      );

      setMessage({
        type: 'success',
        text: `Added "${result.data.originalName}" to library!`,
      });

      // Clear staged file
      if (stagedPreviewUrl) {
        URL.revokeObjectURL(stagedPreviewUrl);
      }
      setStagedFile(null);
      setStagedPreviewUrl(null);
      setUploadName('');
      setUploadDescription('');
      setUploadAuthor('');
      setUploadProgress(null);
      fetchContent();
      setTimeout(() => setMessage(null), 5000);
    } catch (err) {
      setMessage({
        type: 'error',
        text: `Upload failed: ${(err as Error).message}`,
      });
    } finally {
      setUploading(false);
    }
  }, [stagedFile, uploadName, uploadDescription, uploadAuthor, stagedPreviewUrl]);

  const handleClearStagedFile = useCallback(() => {
    if (stagedPreviewUrl) {
      URL.revokeObjectURL(stagedPreviewUrl);
    }
    setStagedFile(null);
    setStagedPreviewUrl(null);
    setUploadName('');
    setUploadDescription('');
    setUploadAuthor('');
  }, [stagedPreviewUrl]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      handleStageFile(file);
    }
  }, [handleStageFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleStageFile(file);
      // Reset input so same file can be selected again
      e.target.value = '';
    }
  }, [handleStageFile]);

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  };

  const getSourceBadge = (sourceType: string) => {
    switch (sourceType) {
      case 'youtube':
        return <span className="badge badge-error">YouTube</span>;
      case 'eden':
      case 'eden_collection':
      case 'eden_creation':
        return <span className="badge badge-success">Eden</span>;
      case 'url':
        return <span className="badge badge-info">URL</span>;
      case 'upload':
        return <span className="badge badge-warning">Uploaded</span>;
      case 'gdrive':
        return <span className="badge badge-info">GDrive</span>;
      default:
        return <span className="badge">{sourceType}</span>;
    }
  };

  const getContentIcon = (type: 'video' | 'image') => {
    if (type === 'video') {
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polygon points="23 7 16 12 23 17 23 7" />
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
        </svg>
      );
    }
    if (type === 'image') {
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      );
    }
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    );
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Content Library</h1>
        <p className="page-subtitle">
          Manage your media content and sources
        </p>
      </div>

      {/* Add Content Form */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-header">
          <h3 className="card-title">Add Content</h3>
        </div>
        <div className="card-body">
          {/* Tab selector - centered */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginBottom: '16px' }}>
            <button
              className={`btn btn-sm ${activeTab === 'url' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setActiveTab('url')}
            >
              From URL
            </button>
            <button
              className={`btn btn-sm ${activeTab === 'upload' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setActiveTab('upload')}
            >
              Upload File
            </button>
          </div>
          {activeTab === 'url' ? (
            <>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">URL</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="YouTube, Eden, Google Drive, or direct media URL"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !showDescription && handleAddContent()}
                />
              </div>

              {/* Collapsible metadata section */}
              <div style={{ marginTop: '12px' }}>
                <button
                  type="button"
                  onClick={() => setShowDescription(!showDescription)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    padding: 0,
                    fontSize: '0.875rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    style={{
                      transform: showDescription ? 'rotate(90deg)' : 'rotate(0deg)',
                      transition: 'transform 0.2s',
                    }}
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                  Add name, description
                </button>

                {showDescription && (
                  <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Name</label>
                      <input
                        type="text"
                        className="form-input"
                        value={nameInput}
                        onChange={(e) => setNameInput(e.target.value)}
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Description</label>
                      <textarea
                        className="form-input"
                        rows={2}
                        value={descriptionInput}
                        onChange={(e) => setDescriptionInput(e.target.value)}
                        style={{ resize: 'vertical' }}
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Author</label>
                      <input
                        type="text"
                        className="form-input"
                        value={authorInput}
                        onChange={(e) => setAuthorInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddContent()}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Add button at bottom */}
              <div style={{ marginTop: '16px' }}>
                <button
                  className="btn btn-primary"
                  onClick={handleAddContent}
                  disabled={!urlInput.trim() || adding}
                  style={{ width: '100%' }}
                >
                  {adding ? 'Adding...' : 'Add to Library'}
                </button>
              </div>
            </>
          ) : (
            <>
              {/* Upload tab content */}
              <input
                ref={fileInputRef}
                type="file"
                accept={ALLOWED_FILE_TYPES.join(',')}
                onChange={handleFileSelect}
                style={{ display: 'none' }}
                disabled={uploading}
              />

              {uploading ? (
                /* Upload progress */
                <div style={{
                  border: '2px dashed var(--border-color)',
                  borderRadius: '8px',
                  padding: '32px 24px',
                  textAlign: 'center',
                }}>
                  <div style={{
                    width: '100%',
                    height: '8px',
                    backgroundColor: 'var(--bg-secondary)',
                    borderRadius: '4px',
                    overflow: 'hidden',
                    marginBottom: '12px',
                  }}>
                    <div style={{
                      width: `${uploadProgress?.percent || 0}%`,
                      height: '100%',
                      backgroundColor: 'var(--primary)',
                      transition: 'width 0.2s',
                    }} />
                  </div>
                  <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
                    Uploading... {uploadProgress?.percent || 0}%
                    {uploadProgress && uploadProgress.total > 0 && (
                      <span style={{ marginLeft: '8px', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                        ({formatBytes(uploadProgress.loaded)} / {formatBytes(uploadProgress.total)})
                      </span>
                    )}
                  </p>
                </div>
              ) : stagedFile ? (
                /* Staged file - show preview and metadata */
                <div>
                  {/* Preview */}
                  <div style={{
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    marginBottom: '16px',
                    position: 'relative',
                  }}>
                    {/* Clear button */}
                    <button
                      onClick={handleClearStagedFile}
                      style={{
                        position: 'absolute',
                        top: '8px',
                        right: '8px',
                        background: 'rgba(0,0,0,0.6)',
                        border: 'none',
                        borderRadius: '50%',
                        width: '28px',
                        height: '28px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 10,
                      }}
                      title="Remove file"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                    {stagedFile.type.startsWith('video/') ? (
                      <video
                        src={stagedPreviewUrl || undefined}
                        style={{ width: '100%', maxHeight: '200px', objectFit: 'contain', backgroundColor: '#000' }}
                        controls
                      />
                    ) : (
                      <img
                        src={stagedPreviewUrl || undefined}
                        alt="Preview"
                        style={{ width: '100%', maxHeight: '200px', objectFit: 'contain', backgroundColor: '#000' }}
                      />
                    )}
                  </div>

                  {/* File info */}
                  <div style={{
                    fontSize: '0.875rem',
                    color: 'var(--text-muted)',
                    marginBottom: '16px',
                  }}>
                    {stagedFile.name} ({formatBytes(stagedFile.size)})
                  </div>

                  {/* Metadata form */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Name</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Display name for this file"
                        value={uploadName}
                        onChange={(e) => setUploadName(e.target.value)}
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Description</label>
                      <textarea
                        className="form-input"
                        rows={2}
                        placeholder="Optional description"
                        value={uploadDescription}
                        onChange={(e) => setUploadDescription(e.target.value)}
                        style={{ resize: 'vertical' }}
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Author</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Author / Creator"
                        value={uploadAuthor}
                        onChange={(e) => setUploadAuthor(e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Add button */}
                  <div style={{ marginTop: '16px' }}>
                    <button
                      className="btn btn-primary"
                      onClick={handleAddUpload}
                      style={{ width: '100%' }}
                    >
                      Add to Library
                    </button>
                  </div>
                </div>
              ) : (
                /* Drop zone - no file staged */
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  style={{
                    border: `2px dashed ${dragActive ? 'var(--primary)' : 'var(--border-color)'}`,
                    borderRadius: '8px',
                    padding: '32px 24px',
                    textAlign: 'center',
                    cursor: 'pointer',
                    backgroundColor: dragActive ? 'rgba(59, 130, 246, 0.05)' : 'transparent',
                    transition: 'all 0.2s',
                  }}
                >
                  <svg
                    width="48"
                    height="48"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1"
                    style={{ color: 'var(--text-muted)', marginBottom: '12px' }}
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  <p style={{ color: 'var(--text-secondary)', margin: '0 0 8px 0' }}>
                    Drag and drop a file here, or click to browse
                  </p>
                  <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '0.875rem' }}>
                    MP4, WebM, MOV, MKV, JPEG, PNG, GIF, WebP
                  </p>
                </div>
              )}
            </>
          )}

          {message && (
            <div style={{
              marginTop: '12px',
              padding: '8px 12px',
              borderRadius: '4px',
              backgroundColor: message.type === 'success' ? 'var(--success-bg, rgba(34, 197, 94, 0.1))' : 'var(--error-bg, rgba(239, 68, 68, 0.1))',
              color: message.type === 'success' ? 'var(--success, #22c55e)' : 'var(--error, #ef4444)',
              fontSize: '0.875rem',
            }}>
              {message.text}
            </div>
          )}
        </div>
      </div>

      {/* Content List */}
      <div className="card">
        <div className="card-header" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 className="card-title">All Content</h3>
            <span className="badge badge-info">
              {totalItems > 100 ? `${content.length} of ${totalItems}` : totalItems} items
            </span>
          </div>
          <input
            type="text"
            className="form-input"
            placeholder="Search by name, author, or description..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1); // Reset to first page on search
            }}
            style={{ maxWidth: '400px' }}
          />
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          {loading ? (
            <div className="loading-container">
              <div className="loading-spinner" />
            </div>
          ) : content.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" width="48" height="48">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <h2 className="empty-state-title">{search ? 'No matches found' : 'No content yet'}</h2>
              <p className="empty-state-description">
                {search ? 'Try a different search term.' : 'Add content using the form above to get started.'}
              </p>
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Content</th>
                  <th>Source</th>
                  <th>Type</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {content.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div className="content-icon">
                          {getContentIcon(item.type)}
                        </div>
                        <div>
                          <div style={{ fontWeight: 500 }}>{item.name || item.filename}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {item.metadata?.author || (item.name ? item.filename : `${item.hash.substring(0, 8)}...`)}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>{getSourceBadge(item.source.type)}</td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                      {item.type}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        {nodes.length > 0 && (
                          <button
                            className="btn btn-sm"
                            style={{ padding: '6px 8px', backgroundColor: 'var(--success)', color: 'white' }}
                            onClick={() => setSendToContent(item)}
                            disabled={sendingTo?.contentId === item.id}
                            title="Send to node"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </button>
                        )}
                        <button
                          className="btn btn-sm"
                          style={{ padding: '6px 8px', color: 'var(--text-secondary)' }}
                          onClick={() => handleOpenDetails(item)}
                          title="View/edit details"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                        <button
                          className="btn btn-sm"
                          style={{ padding: '6px 8px', backgroundColor: 'var(--error)', color: 'white' }}
                          onClick={() => handleDeleteContent(item)}
                          title="Delete from library"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Pagination controls */}
          {totalItems > 100 && (
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '16px',
              padding: '16px',
              borderTop: '1px solid var(--border-color)',
            }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1 || loading}
              >
                Previous
              </button>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                Page {page} of {Math.ceil(totalItems / 100)}
              </span>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setPage(p => p + 1)}
                disabled={page >= Math.ceil(totalItems / 100) || loading}
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Details Modal */}
      {selectedContent && (
        <div className="modal-overlay" onClick={() => setSelectedContent(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Content Details</h3>
              <button
                className="modal-close"
                onClick={() => setSelectedContent(null)}
              >
                &times;
              </button>
            </div>
            <div className="modal-body">
              {/* Editable fields */}
              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label className="form-label">Name</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Display name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </div>
              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label className="form-label">Description</label>
                <textarea
                  className="form-input"
                  rows={2}
                  placeholder="Description"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  style={{ resize: 'vertical' }}
                />
              </div>
              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label className="form-label">Author</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Author / Creator"
                  value={editAuthor}
                  onChange={(e) => setEditAuthor(e.target.value)}
                />
              </div>

              {/* Read-only details */}
              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px', marginTop: '8px' }}>
                <div className="detail-row">
                  <span className="detail-label">Filename</span>
                  <span className="detail-value" style={{ wordBreak: 'break-all' }}>
                    {selectedContent.filename}
                  </span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Hash</span>
                  <span className="detail-value" style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                    {selectedContent.hash}
                  </span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Type</span>
                  <span className="detail-value">{selectedContent.type}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Source</span>
                  <span className="detail-value">{selectedContent.source.type}</span>
                </div>
                {selectedContent.originalUrl && (
                  <div className="detail-row">
                    <span className="detail-label">Original URL</span>
                    <span className="detail-value" style={{ wordBreak: 'break-all', fontSize: '0.875rem' }}>
                      {selectedContent.originalUrl}
                    </span>
                  </div>
                )}
                <div className="detail-row">
                  <span className="detail-label">Size</span>
                  <span className="detail-value">
                    {selectedContent.sizeBytes > 0 ? formatBytes(selectedContent.sizeBytes) : 'Unknown (not yet downloaded)'}
                  </span>
                </div>
                {selectedContent.duration && (
                  <div className="detail-row">
                    <span className="detail-label">Duration</span>
                    <span className="detail-value">{selectedContent.duration}s</span>
                  </div>
                )}
                <div className="detail-row">
                  <span className="detail-label">Created</span>
                  <span className="detail-value">
                    {new Date(selectedContent.createdAt).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => setSelectedContent(null)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSaveContent}
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Send to Node Modal */}
      {sendToContent && (
        <div className="modal-overlay" onClick={() => setSendToContent(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <div className="modal-header">
              <h3 className="modal-title">Send to Node</h3>
              <button
                className="modal-close"
                onClick={() => setSendToContent(null)}
              >
                &times;
              </button>
            </div>
            <div className="modal-body">
              <p style={{ marginBottom: '16px', color: 'var(--text-secondary)' }}>
                Select a node to send <strong>{sendToContent.name || sendToContent.filename}</strong> to:
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {nodes.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>
                    No nodes connected
                  </p>
                ) : (
                  nodes.map(node => (
                    <button
                      key={node.node.id}
                      className="btn btn-secondary"
                      style={{ width: '100%', justifyContent: 'flex-start', textAlign: 'left' }}
                      onClick={() => handleSendToNode(sendToContent, node.node.id)}
                      disabled={sendingTo !== null}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%' }}>
                        <span className={`status-dot ${node.connected ? 'online' : 'offline'}`} />
                        <span style={{ flex: 1 }}>{node.node.friendlyName}</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {node.node.ip}
                        </span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => setSendToContent(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
