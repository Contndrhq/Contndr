import { X, ArrowRight } from 'lucide-react';

interface CreateABTestModalProps {
  campaigns: any[];
  newTest: {
    campaignId: string;
    name: string;
    description: string;
    brand: string;
    testType: 'subject' | 'body' | 'cta' | 'full';
    variantA: {
      name: string;
      subjectLine: string;
      emailBody: string;
    };
    variantB: {
      name: string;
      subjectLine: string;
      emailBody: string;
    };
    sampleSize: number;
    winnerMetric: 'open_rate' | 'click_rate' | 'reply_rate';
    minConfidence: number;
  };
  setNewTest: (test: any) => void;
  creating: boolean;
  onClose: () => void;
  onCreate: () => void;
  onNavigateToCampaigns?: () => void;
}

export function CreateABTestModal({
  campaigns,
  newTest,
  setNewTest,
  creating,
  onClose,
  onCreate,
  onNavigateToCampaigns,
}: CreateABTestModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white dark:bg-gray-900 rounded-lg p-6 max-w-3xl w-full my-8 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-semibold">Create A/B Test</h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-6">
          {/* Basic Info */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Test Name *</label>
              <input
                type="text"
                value={newTest.name}
                onChange={(e) => setNewTest({ ...newTest, name: e.target.value })}
                placeholder="e.g., Subject Line Test - Q4 2024"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-slate-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Description</label>
              <textarea
                value={newTest.description}
                onChange={(e) => setNewTest({ ...newTest, description: e.target.value })}
                placeholder="Optional description of the test"
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-slate-500 focus:border-transparent"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Campaign (Optional)</label>
                <select
                  value={newTest.campaignId}
                  onChange={(e) => setNewTest({ ...newTest, campaignId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-slate-500 focus:border-transparent"
                >
                  <option value="">None - Standalone Test</option>
                  {campaigns.map((campaign) => (
                    <option key={campaign.id} value={campaign.id}>
                      {campaign.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Brand</label>
                <input
                  type="text"
                  value={newTest.brand}
                  onChange={(e) => setNewTest({ ...newTest, brand: e.target.value })}
                  placeholder="e.g., Acme Corp"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-slate-500 focus:border-transparent"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Test Type</label>
                <select
                  value={newTest.testType}
                  onChange={(e) => setNewTest({ ...newTest, testType: e.target.value as any })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-slate-500 focus:border-transparent"
                >
                  <option value="subject">Subject Line</option>
                  <option value="body">Email Body</option>
                  <option value="cta">Call-to-Action</option>
                  <option value="full">Full Email</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Winner Metric</label>
                <select
                  value={newTest.winnerMetric}
                  onChange={(e) => setNewTest({ ...newTest, winnerMetric: e.target.value as any })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-slate-500 focus:border-transparent"
                >
                  <option value="open_rate">Open Rate</option>
                  <option value="click_rate">Click Rate</option>
                  <option value="reply_rate">Reply Rate</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Sample Size</label>
                <input
                  type="number"
                  value={newTest.sampleSize}
                  onChange={(e) => setNewTest({ ...newTest, sampleSize: parseInt(e.target.value) || 0 })}
                  min="10"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-slate-500 focus:border-transparent"
                />
              </div>
            </div>
          </div>

          {/* Variant A */}
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <h4 className="font-medium mb-4">Variant A</h4>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-2">Variant Name</label>
                <input
                  type="text"
                  value={newTest.variantA.name}
                  onChange={(e) => setNewTest({ 
                    ...newTest, 
                    variantA: { ...newTest.variantA, name: e.target.value }
                  })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-slate-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Subject Line *</label>
                <input
                  type="text"
                  value={newTest.variantA.subjectLine}
                  onChange={(e) => setNewTest({ 
                    ...newTest, 
                    variantA: { ...newTest.variantA, subjectLine: e.target.value }
                  })}
                  placeholder="e.g., Boost your revenue with Roadr"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-slate-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Email Body</label>
                <textarea
                  value={newTest.variantA.emailBody}
                  onChange={(e) => setNewTest({ 
                    ...newTest, 
                    variantA: { ...newTest.variantA, emailBody: e.target.value }
                  })}
                  rows={4}
                  placeholder="Email body content..."
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-slate-500 focus:border-transparent"
                />
              </div>
            </div>
          </div>

          {/* Variant B */}
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <h4 className="font-medium mb-4">Variant B</h4>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-2">Variant Name</label>
                <input
                  type="text"
                  value={newTest.variantB.name}
                  onChange={(e) => setNewTest({ 
                    ...newTest, 
                    variantB: { ...newTest.variantB, name: e.target.value }
                  })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-slate-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Subject Line *</label>
                <input
                  type="text"
                  value={newTest.variantB.subjectLine}
                  onChange={(e) => setNewTest({ 
                    ...newTest, 
                    variantB: { ...newTest.variantB, subjectLine: e.target.value }
                  })}
                  placeholder="e.g., Transform your auto shop with Roadr"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-slate-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Email Body</label>
                <textarea
                  value={newTest.variantB.emailBody}
                  onChange={(e) => setNewTest({ 
                    ...newTest, 
                    variantB: { ...newTest.variantB, emailBody: e.target.value }
                  })}
                  rows={4}
                  placeholder="Email body content..."
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-slate-500 focus:border-transparent"
                />
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={onClose}
              disabled={creating}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={onCreate}
              disabled={creating}
              className="px-6 py-2 bg-slate-700 dark:bg-slate-600 text-white rounded-lg hover:bg-slate-800 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creating ? 'Creating...' : 'Create A/B Test'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}