import { useState, useEffect } from 'react';
import { X, Folder, Check } from 'lucide-react';
import { getAuthHeaders } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { IconButton } from './ui/icon-button';

interface Group {
  id: string;
  name: string;
  description: string;
  color: string;
}

interface GroupSelectorProps {
  onClose: () => void;
  selectedLeadIds: string[];
  onSuccess: () => void;
}

export function GroupSelector({ onClose, selectedLeadIds, onSuccess }: GroupSelectorProps) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    loadGroups();
  }, []);

  async function loadGroups() {
    try {
      setLoading(true);
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/lead-groups`,
        { headers }
      );

      if (!response.ok) {
        throw new Error('Failed to load groups');
      }

      const data = await response.json();
      setGroups(data.groups || []);
    } catch (error) {
      console.error('Error loading groups:', error);
      alert('Failed to load groups');
    } finally {
      setLoading(false);
    }
  }

  async function addToGroup(groupId: string, groupName: string) {
    setAdding(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/lead-groups/${groupId}/leads`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ lead_ids: selectedLeadIds }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to add leads to group');
      }

      alert(`✓ Successfully added ${selectedLeadIds.length} leads to "${groupName}"`);
      onSuccess();
      onClose();
    } catch (error) {
      console.error('Error adding leads to group:', error);
      alert('Failed to add leads to group');
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 animate-fade-in">
      <div 
        className="absolute inset-0 bg-black/20 dark:bg-black/60 backdrop-blur-heavy"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md bg-white dark:bg-gray-900 rounded-xl shadow-xl animate-scale-in border border-[var(--border)]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[var(--border)]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-zinc-200 dark:bg-zinc-800 rounded-lg flex items-center justify-center">
              <Folder className="w-5 h-5 text-zinc-500 dark:text-zinc-400" strokeWidth={2} />
            </div>
            <div>
              <h2 className="text-[16px] text-[var(--foreground)]">Add to Group</h2>
              <p className="text-[12px] text-[var(--foreground-muted)]">
                {selectedLeadIds.length} lead{selectedLeadIds.length !== 1 ? 's' : ''} selected
              </p>
            </div>
          </div>
          <IconButton size="sm" onClick={onClose} title="Close" aria-label="Close">
            <X />
          </IconButton>
        </div>

        {/* Groups List */}
        <div className="p-5">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-14 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : groups.length === 0 ? (
            <div className="text-center py-8">
              <Folder className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
              <p className="text-[14px] text-[var(--foreground-muted)] mb-4">
                No groups yet. Create a group first.
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {groups.map(group => (
                <button
                  key={group.id}
                  onClick={() => addToGroup(group.id, group.name)}
                  disabled={adding}
                  className="w-full flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-800 hover:border-zinc-400 dark:hover:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-left"
                >
                  <div 
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: group.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] text-[var(--foreground)] truncate">
                      {group.name}
                    </p>
                    {group.description && (
                      <p className="text-[12px] text-[var(--foreground-muted)] truncate">
                        {group.description}
                      </p>
                    )}
                  </div>
                  <Check className="w-4 h-4 text-[#1ED4A7] opacity-0 group-hover:opacity-100 flex-shrink-0" strokeWidth={2} />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-5 border-t border-[var(--border)]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[13px] text-[var(--foreground)] hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}