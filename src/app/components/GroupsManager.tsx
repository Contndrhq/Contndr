import { useState, useEffect } from 'react';
import { X, Plus, Edit2, Trash2, Users, Folder } from 'lucide-react';
import { getAuthHeaders } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { LoadingSpinner } from './LoadingSpinner';
import { IconButton } from './ui/icon-button';

interface Group {
  id: string;
  name: string;
  description: string;
  color: string;
  created_at: string;
  lead_count: { count: number }[];
}

interface GroupsManagerProps {
  onClose: () => void;
  onGroupCreated?: () => void;
}

export function GroupsManager({ onClose, onGroupCreated }: GroupsManagerProps) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    color: '#1ED4A7',
  });

  const colors = [
    { value: '#1ED4A7', label: 'Teal' },
    { value: '#050505', label: 'Black' },
    { value: '#52525b', label: 'Zinc' },
    { value: '#78716c', label: 'Stone' },
    { value: '#64748b', label: 'Slate' },
    { value: '#ef4444', label: 'Red' },
    { value: '#f59e0b', label: 'Amber' },
    { value: '#6b7280', label: 'Gray' },
  ];

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    try {
      const headers = await getAuthHeaders();
      const url = editingGroup
        ? `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/lead-groups/${editingGroup.id}`
        : `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/lead-groups`;

      const response = await fetch(url, {
        method: editingGroup ? 'PUT' : 'POST',
        headers,
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        throw new Error('Failed to save group');
      }

      setFormData({ name: '', description: '', color: '#1ED4A7' });
      setEditingGroup(null);
      setIsCreating(false);
      await loadGroups();
      onGroupCreated?.();
    } catch (error) {
      console.error('Error saving group:', error);
      alert('Failed to save group');
    }
  }

  async function handleDelete(groupId: string) {
    if (!confirm('Are you sure you want to delete this group? Leads will not be deleted.')) {
      return;
    }

    try {
      const headers = await getAuthHeaders();
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/lead-groups/${groupId}`,
        {
          method: 'DELETE',
          headers,
        }
      );

      if (!response.ok) {
        throw new Error('Failed to delete group');
      }

      await loadGroups();
      onGroupCreated?.();
    } catch (error) {
      console.error('Error deleting group:', error);
      alert('Failed to delete group');
    }
  }

  function startEdit(group: Group) {
    setEditingGroup(group);
    setFormData({
      name: group.name,
      description: group.description || '',
      color: group.color || '#1ED4A7',
    });
    setIsCreating(true);
  }

  function cancelEdit() {
    setEditingGroup(null);
    setFormData({ name: '', description: '', color: '#1ED4A7' });
    setIsCreating(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col border border-gray-200 dark:border-gray-800">
        {/* Header */}
        <div className="p-6 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
          <div>
            <h2 className="text-[22px] font-semibold text-gray-900 dark:text-white">Manage Groups</h2>
            <p className="text-[14px] text-gray-500 dark:text-gray-400 mt-1">
              Organize your leads into custom groups
            </p>
          </div>
          <IconButton onClick={onClose} title="Close" aria-label="Close">
            <X strokeWidth={2} />
          </IconButton>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Create/Edit Form */}
          {isCreating ? (
            <form onSubmit={handleSubmit} className="p-5 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700 space-y-4">
              <h3 className="font-semibold text-gray-900 dark:text-white">
                {editingGroup ? 'Edit Group' : 'Create New Group'}
              </h3>

              <div>
                <label className="block text-[13px] text-gray-700 dark:text-gray-300 mb-2 font-medium">
                  Group Name
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., High Priority Leads"
                  required
                  className="w-full px-3.5 py-2.5 text-[14px] border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 rounded-lg focus:outline-none focus:border-gray-900 dark:focus:border-white focus:ring-1 focus:ring-gray-900 dark:focus:ring-white transition-all"
                />
              </div>

              <div>
                <label className="block text-[13px] text-gray-700 dark:text-gray-300 mb-2 font-medium">
                  Description (Optional)
                </label>
                <textarea
                  value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Describe this group..."
                  rows={2}
                  className="w-full px-3.5 py-2.5 text-[14px] border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 rounded-lg focus:outline-none focus:border-gray-900 dark:focus:border-white focus:ring-1 focus:ring-gray-900 dark:focus:ring-white transition-all resize-none"
                />
              </div>

              <div>
                <label className="block text-[13px] text-gray-700 dark:text-gray-300 mb-2.5 font-medium">
                  Color
                </label>
                <div className="grid grid-cols-8 gap-2">
                  {colors.map(color => (
                    <button
                      key={color.value}
                      type="button"
                      onClick={() => setFormData({ ...formData, color: color.value })}
                      className={`w-10 h-10 rounded-lg border-2 transition-all ${
                        formData.color === color.value
                          ? 'border-gray-900 dark:border-white scale-110'
                          : 'border-transparent hover:scale-105'
                      }`}
                      style={{ backgroundColor: color.value }}
                      title={color.label}
                    />
                  ))}
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="px-4 py-2 text-[14px] font-medium border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-[14px] font-semibold rounded-lg hover:bg-gray-800 dark:hover:bg-gray-100 transition-all"
                >
                  {editingGroup ? 'Update Group' : 'Create Group'}
                </button>
              </div>
            </form>
          ) : (
            <button
              onClick={() => setIsCreating(true)}
              className="w-full p-4 border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl text-gray-600 dark:text-gray-400 hover:border-gray-900 dark:hover:border-white hover:text-gray-900 dark:hover:text-white transition-all flex items-center justify-center gap-2"
            >
              <Plus className="w-5 h-5" strokeWidth={2} />
              <span className="font-medium">Create New Group</span>
            </button>
          )}

          {/* Groups List */}
          {loading ? (
            <LoadingSpinner size="xl" text="Loading groups..." center />
          ) : groups.length === 0 ? (
            <div className="text-center py-12">
              <Folder className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
              <p className="text-gray-500 dark:text-gray-400 text-[14px]">
                No groups yet. Create your first group to get started.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {groups.map(group => {
                const leadCount = group.lead_count?.[0]?.count || 0;
                return (
                  <div
                    key={group.id}
                    className="p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl hover:shadow-md transition-all"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div
                          className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                          style={{ backgroundColor: group.color + '20' }}
                        >
                          <Folder
                            className="w-5 h-5"
                            style={{ color: group.color }}
                            strokeWidth={2}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-gray-900 dark:text-white truncate">
                            {group.name}
                          </h4>
                          {group.description && (
                            <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                              {group.description}
                            </p>
                          )}
                          <div className="flex items-center gap-1.5 mt-2">
                            <Users className="w-4 h-4 text-gray-400 dark:text-gray-500" strokeWidth={2} />
                            <span className="text-[13px] text-gray-600 dark:text-gray-400">
                              {leadCount} {leadCount === 1 ? 'lead' : 'leads'}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => startEdit(group)}
                          className="p-2 text-gray-400 dark:text-gray-500 hover:text-[#1ED4A7] hover:bg-[#1ED4A7]/10 rounded-lg transition-all"
                          title="Edit group"
                        >
                          <Edit2 className="w-4 h-4" strokeWidth={2} />
                        </button>
                        <button
                          onClick={() => handleDelete(group.id)}
                          className="p-2 text-gray-400 dark:text-gray-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-all"
                          title="Delete group"
                        >
                          <Trash2 className="w-4 h-4" strokeWidth={2} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}