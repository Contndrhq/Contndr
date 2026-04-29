/**
 * MOBILE OPTIMIZATION EXAMPLE
 * 
 * This file shows a complete before/after example of converting a desktop modal
 * to a mobile-optimized bottom sheet using the new mobile components.
 * 
 * Use this as a reference when updating other components.
 */

import React, { useState } from 'react';
import { X, Loader2, Building2, User, Mail, Phone, Tag } from 'lucide-react';
import { useIsMobile } from './components/ui/use-mobile';
import {
  MobileSheet,
  MobileFormField,
  MobileInput,
  MobileTextarea,
  MobileChipGroup,
  MobileChip,
  MobileCTA,
  MobileSection,
} from './components/ui/mobile-sheet';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './components/ui/dialog';

// ============================================================================
// BEFORE: Desktop-only Modal (breaks on mobile)
// ============================================================================

function CreateLeadModalBefore({ isOpen, onClose }: any) {
  const [formData, setFormData] = useState({
    name: '',
    company: '',
    email: '',
    phone: '',
    category: '',
    notes: '',
  });

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Lead</DialogTitle>
          <DialogDescription>Add a new lead to your CRM</DialogDescription>
        </DialogHeader>

        {/* ❌ PROBLEMS:
          - Two-column grid breaks on small screens
          - Inputs too small (< 44px touch target)
          - Font size < 16px causes iOS zoom
          - No safe area padding
          - CTA too close to bottom nav
          - Chips too small for touch
        */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs">Name</label>
            <input type="text" className="w-full p-2 text-sm border rounded" />
          </div>
          <div>
            <label className="text-xs">Company</label>
            <input type="text" className="w-full p-2 text-sm border rounded" />
          </div>
        </div>

        <div className="flex gap-2 mt-4">
          <button className="px-3 py-1.5 text-sm border rounded">Cancel</button>
          <button className="px-3 py-1.5 text-sm bg-teal-500 text-white rounded">Save</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// AFTER: Mobile-Optimized with Responsive Pattern
// ============================================================================

interface CreateLeadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave?: (data: any) => Promise<void>;
}

export function CreateLeadModal({ isOpen, onClose, onSave }: CreateLeadModalProps) {
  const isMobile = useIsMobile();
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    company: '',
    email: '',
    phone: '',
    category: '',
    notes: '',
  });

  const categories = ['SaaS', 'Agency', 'Consultant', 'E-commerce', 'Other'];
  const [selectedCategory, setSelectedCategory] = useState('');

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave?.(formData);
      onClose();
    } catch (error) {
      console.error('Save failed:', error);
    } finally {
      setSaving(false);
    }
  };

  // ✅ Mobile Version (< 640px)
  if (isMobile) {
    return (
      <MobileSheet
        isOpen={isOpen}
        onClose={onClose}
        title="Create Lead"
        description="Add a new lead to your CRM"
        size="large"
        showHandle={true}
        footer={
          <div className="flex flex-col gap-2">
            {/* Primary CTA */}
            <MobileCTA onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="w-5 h-5 animate-spin" />}
              Save Lead
            </MobileCTA>
            
            {/* Secondary action */}
            <MobileCTA variant="ghost" onClick={onClose}>
              Cancel
            </MobileCTA>
          </div>
        }
      >
        {/* ✅ Single-column layout */}
        <div className="space-y-6">
          {/* Contact Information Section */}
          <MobileSection title="Contact Information">
            <MobileFormField label="Full Name">
              <MobileInput
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="John Smith"
              />
            </MobileFormField>

            <MobileFormField label="Company Name">
              <MobileInput
                type="text"
                value={formData.company}
                onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                placeholder="Acme Corp"
              />
            </MobileFormField>

            <MobileFormField label="Email Address">
              <MobileInput
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="john@acme.com"
              />
            </MobileFormField>

            <MobileFormField label="Phone Number">
              <MobileInput
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="(555) 123-4567"
              />
            </MobileFormField>
          </MobileSection>

          {/* Category Section */}
          <MobileSection title="Category">
            {/* ✅ Touch-friendly chips that wrap */}
            <MobileChipGroup>
              {categories.map((cat) => (
                <MobileChip
                  key={cat}
                  selected={selectedCategory === cat}
                  onClick={() => setSelectedCategory(cat)}
                >
                  {cat}
                </MobileChip>
              ))}
            </MobileChipGroup>
          </MobileSection>

          {/* Notes Section */}
          <MobileSection title="Notes">
            <MobileFormField label="Additional Information">
              <MobileTextarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Any additional notes about this lead..."
                rows={4}
              />
            </MobileFormField>
          </MobileSection>
        </div>
      </MobileSheet>
    );
  }

  // ✅ Desktop Version (≥ 640px)
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Create Lead</DialogTitle>
          <DialogDescription>Add a new lead to your CRM</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {/* Contact Information */}
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-3">
              Contact Information
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">Full Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="John Smith"
                  className="w-full px-3 py-2 border border-zinc-200 dark:border-white/10 rounded-lg bg-white dark:bg-zinc-900 focus:ring-2 focus:ring-teal-500/30"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Company</label>
                <input
                  type="text"
                  value={formData.company}
                  onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                  placeholder="Acme Corp"
                  className="w-full px-3 py-2 border border-zinc-200 dark:border-white/10 rounded-lg bg-white dark:bg-zinc-900 focus:ring-2 focus:ring-teal-500/30"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Email</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="john@acme.com"
                  className="w-full px-3 py-2 border border-zinc-200 dark:border-white/10 rounded-lg bg-white dark:bg-zinc-900 focus:ring-2 focus:ring-teal-500/30"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Phone</label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="(555) 123-4567"
                  className="w-full px-3 py-2 border border-zinc-200 dark:border-white/10 rounded-lg bg-white dark:bg-zinc-900 focus:ring-2 focus:ring-teal-500/30"
                />
              </div>
            </div>
          </div>

          {/* Category */}
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-3">
              Category
            </h3>
            <div className="flex flex-wrap gap-2">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border-2 transition-all ${
                    selectedCategory === cat
                      ? 'border-teal-500 bg-teal-500/10 text-teal-500'
                      : 'border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-white/20'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-3">
              Notes
            </h3>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Any additional notes about this lead..."
              rows={4}
              className="w-full px-3 py-2 border border-zinc-200 dark:border-white/10 rounded-lg bg-white dark:bg-zinc-900 focus:ring-2 focus:ring-teal-500/30 resize-vertical"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-zinc-200 dark:border-white/10">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-lg font-medium text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Save Lead
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// KEY IMPROVEMENTS IN MOBILE VERSION
// ============================================================================

/**
 * ✅ MOBILE IMPROVEMENTS:
 * 
 * 1. LAYOUT
 *    - Single column (was 2-column grid)
 *    - Vertical sections with clear hierarchy
 *    - Proper spacing between sections
 * 
 * 2. FORM FIELDS
 *    - 16px font size (prevents iOS zoom)
 *    - 44px minimum height (Apple HIG)
 *    - 12px border radius (iOS-style)
 *    - Labels above inputs (not beside)
 * 
 * 3. TOUCH TARGETS
 *    - All chips: 44px × minimum width
 *    - Proper spacing between chips (8px)
 *    - Full-width CTA buttons (52px)
 * 
 * 4. SAFE AREA
 *    - Footer accounts for safe-area-inset-bottom
 *    - Extra padding when bottom nav is present
 *    - Content doesn't overlap with nav
 * 
 * 5. KEYBOARD
 *    - Inputs auto-scroll when focused
 *    - CTA always visible above keyboard
 *    - No layout shift during keyboard appearance
 * 
 * 6. VISUAL DESIGN
 *    - Rounded top corners (28px)
 *    - Drag handle for discoverability
 *    - Smooth slide-in animation
 *    - Tap outside to dismiss
 * 
 * 7. RESPONSIVE
 *    - useIsMobile() hook for detection
 *    - Separate mobile/desktop implementations
 *    - Consistent behavior across breakpoints
 */

// ============================================================================
// MIGRATION CHECKLIST
// ============================================================================

/**
 * When converting a component, ensure:
 * 
 * [ ] Import useIsMobile hook
 * [ ] Import mobile components from mobile-sheet
 * [ ] Detect mobile and render conditionally
 * [ ] Convert form to single column
 * [ ] Use MobileFormField for all fields
 * [ ] Use MobileInput/MobileTextarea (16px font)
 * [ ] Convert multi-selects to MobileChipGroup
 * [ ] Move CTAs to footer prop
 * [ ] Add safe area padding
 * [ ] Test on iPhone simulator
 * [ ] Test keyboard behavior
 * [ ] Test with bottom nav visible
 * [ ] Verify 44px touch targets
 * [ ] Test light + dark mode
 */
