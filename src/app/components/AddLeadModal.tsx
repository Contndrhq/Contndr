import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, User, Mail, Phone, Building, Globe, MapPin, Briefcase, Linkedin, StickyNote, Loader2, UserPlus, ChevronDown, ChevronUp, Sparkles, CheckCircle2, AlertCircle, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { authenticatedFetch } from '../lib/auth';
import { projectId } from '../utils/supabase/info';
import { motion, AnimatePresence } from 'motion/react';
import { formatPhoneInput, phoneToDigits, formatPhoneDisplay } from '../lib/phone-format';
import { IconButton } from './ui/icon-button';
import { useTranslation } from 'react-i18next';

interface AddLeadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLeadAdded: () => void;
  onUpgrade?: () => void;
}

interface LeadFormData {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  business_name: string;
  website: string;
  job_title: string;
  industry: string;
  city: string;
  state: string;
  country: string;
  linkedin: string;
  notes: string;
  stage: string;
}

const INITIAL_FORM: LeadFormData = {
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  business_name: '',
  website: '',
  job_title: '',
  industry: '',
  city: '',
  state: '',
  country: '',
  linkedin: '',
  notes: '',
  stage: 'new',
};

const STAGE_OPTIONS = [
  { value: 'new', label: 'New', color: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' },
  { value: 'contacted', label: 'Contacted', color: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' },
  { value: 'qualified', label: 'Qualified', color: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' },
  { value: 'proposal', label: 'Proposal', color: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' },
  { value: 'negotiation', label: 'Negotiation', color: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' },
  { value: 'won', label: 'Won', color: 'bg-[#1ED4A7]/10 text-[#1ED4A7] dark:bg-[#1ED4A7]/10 dark:text-[#1ED4A7]' },
  { value: 'lost', label: 'Lost', color: 'bg-zinc-300 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-400' },
];

function isLinkedInUrl(text: string): boolean {
  return /linkedin\.com\/in\//i.test(text.trim());
}

export function AddLeadModal({ isOpen, onClose, onLeadAdded, onUpgrade }: AddLeadModalProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<LeadFormData>({ ...INITIAL_FORM });
  const [saving, setSaving] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof LeadFormData, string>>>({});

  // LinkedIn auto-fill state
  const [linkedinInput, setLinkedinInput] = useState('');
  const [enriching, setEnriching] = useState(false);
  const [enrichResult, setEnrichResult] = useState<'success' | 'error' | null>(null);
  const [enrichError, setEnrichError] = useState('');
  const [enrichedFields, setEnrichedFields] = useState<Set<string>>(new Set());
  const linkedinInputRef = useRef<HTMLInputElement>(null);

  // Reset enrichment state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setLinkedinInput('');
      setEnrichResult(null);
      setEnrichError('');
      setEnrichedFields(new Set());
    }
  }, [isOpen]);

  if (!isOpen) return null;

  function updateField(field: keyof LeadFormData, value: string) {
    setForm(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  }

  // Handle paste in the LinkedIn input — auto-trigger enrichment
  function handleLinkedinPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData('text');
    if (isLinkedInUrl(pasted)) {
      e.preventDefault();
      setLinkedinInput(pasted.trim());
      enrichFromLinkedIn(pasted.trim());
    }
  }

  // Handle typing/change in LinkedIn input
  function handleLinkedinChange(val: string) {
    setLinkedinInput(val);
    setEnrichResult(null);
    setEnrichError('');
  }

  async function enrichFromLinkedIn(url?: string) {
    const targetUrl = (url || linkedinInput).trim();
    if (!targetUrl) return;

    if (!isLinkedInUrl(targetUrl)) {
      setEnrichError(t('addLeadModal.invalidLinkedInUrl'));
      setEnrichResult('error');
      return;
    }

    setEnriching(true);
    setEnrichResult(null);
    setEnrichError('');
    setEnrichedFields(new Set());

    try {
      const response = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/deep-prospect/enrich-linkedin`,
        {
          method: 'POST',
          body: JSON.stringify({ linkedin_url: targetUrl }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        setEnrichError(data.error || t('addLeadModal.couldNotFindProfile'));
        setEnrichResult('error');
        // Still set the LinkedIn URL in the form
        updateField('linkedin', targetUrl);
        return;
      }

      const enriched = data.data;
      const filledFields = new Set<string>();

      // Only fill fields that are currently empty
      setForm(prev => {
        const updated = { ...prev };

        if (enriched.first_name && !prev.first_name) { updated.first_name = enriched.first_name; filledFields.add('first_name'); }
        if (enriched.last_name && !prev.last_name) { updated.last_name = enriched.last_name; filledFields.add('last_name'); }
        if (enriched.email && !prev.email) { updated.email = enriched.email; filledFields.add('email'); }
        if (enriched.phone && !prev.phone) { updated.phone = formatPhoneInput(enriched.phone); filledFields.add('phone'); }
        if (enriched.company_name && !prev.business_name) { updated.business_name = enriched.company_name; filledFields.add('business_name'); }
        if (enriched.website && !prev.website) { updated.website = enriched.website; filledFields.add('website'); }
        if (enriched.title && !prev.job_title) { updated.job_title = enriched.title; filledFields.add('job_title'); }
        if (enriched.industry && !prev.industry) { updated.industry = enriched.industry; filledFields.add('industry'); }
        if (enriched.city && !prev.city) { updated.city = enriched.city; filledFields.add('city'); }
        if (enriched.state && !prev.state) { updated.state = enriched.state; filledFields.add('state'); }
        if (enriched.country && !prev.country) { updated.country = enriched.country; filledFields.add('country'); }
        updated.linkedin = enriched.linkedin_url || targetUrl;
        filledFields.add('linkedin');

        return updated;
      });

      setEnrichedFields(filledFields);
      setEnrichResult('success');

      // Auto-expand "More details" if location was filled
      if (enriched.city || enriched.state || enriched.country) {
        setShowMore(true);
      }

      toast.success(t('addLeadModal.profileEnriched'), {
        description: `${enriched.first_name} ${enriched.last_name}${enriched.company_name ? ` at ${enriched.company_name}` : ''}`,
      });
    } catch (error: any) {
      console.error('[LINKEDIN ENRICH] Error:', error);
      setEnrichError(error.message || t('addLeadModal.failedEnrich'));
      setEnrichResult('error');
      updateField('linkedin', targetUrl);
    } finally {
      setEnriching(false);
    }
  }

  function validate(): boolean {
    const newErrors: Partial<Record<keyof LeadFormData, string>> = {};
    
    const hasName = form.first_name.trim() || form.last_name.trim();
    const hasEmail = form.email.trim();
    const hasBusiness = form.business_name.trim();
    
    if (!hasName && !hasEmail && !hasBusiness) {
      newErrors.first_name = t('addLeadModal.provideAtLeast');
    }
    
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      newErrors.email = t('addLeadModal.invalidEmail');
    }
    
    if (form.website.trim() && !/^(https?:\/\/)?[\w.-]+\.\w{2,}/.test(form.website.trim())) {
      newErrors.website = t('addLeadModal.invalidWebsite');
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setSaving(true);
    try {
      const response = await authenticatedFetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/crm/leads/create`,
        {
          method: 'POST',
          body: JSON.stringify({
            first_name: form.first_name.trim() || undefined,
            last_name: form.last_name.trim() || undefined,
            email: form.email.trim() || undefined,
            phone: form.phone.trim() ? phoneToDigits(form.phone) : undefined,
            business_name: form.business_name.trim() || undefined,
            website: form.website.trim() || undefined,
            job_title: form.job_title.trim() || undefined,
            industry: form.industry.trim() || undefined,
            city: form.city.trim() || undefined,
            state: form.state.trim() || undefined,
            country: form.country.trim() || undefined,
            linkedin: form.linkedin.trim() || undefined,
            notes: form.notes.trim() || undefined,
            stage: form.stage || 'new',
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 403 && data.error === 'LEAD_LIMIT_EXCEEDED') {
          toast.error(t('addLeadModal.leadLimitReached'), {
            description: data.message || t('addLeadModal.leadLimitMsg'),
            duration: 6000,
            action: onUpgrade ? { label: t('common.upgrade'), onClick: onUpgrade } : undefined,
          });
          if (onUpgrade) {
            onClose();
            setTimeout(() => onUpgrade(), 500);
          }
          return;
        }
        if (data.duplicate) {
          // Silently skip — lead already exists, just close the modal
          console.log('[ADD LEAD] Duplicate skipped:', data.error);
          setForm({ ...INITIAL_FORM });
          setShowMore(false);
          setErrors({});
          setLinkedinInput('');
          setEnrichResult(null);
          setEnrichedFields(new Set());
          onClose();
          return;
        } else {
          toast.error(t('addLeadModal.failedToAddLead'), { description: data.error || 'Unknown error' });
        }
        console.error('[ADD LEAD] Error:', data);
        return;
      }

      toast.success(t('addLeadModal.leadAdded'), {
        description: `${form.first_name || ''} ${form.last_name || ''} ${form.business_name ? `(${form.business_name})` : ''}`.trim(),
      });

      setForm({ ...INITIAL_FORM });
      setShowMore(false);
      setErrors({});
      setLinkedinInput('');
      setEnrichResult(null);
      setEnrichedFields(new Set());
      onLeadAdded();
      onClose();
    } catch (error: any) {
      console.error('[ADD LEAD] Network error:', error);
      toast.error(t('addLeadModal.networkError'), { description: error.message || t('addLeadModal.couldNotReachServer') });
    } finally {
      setSaving(false);
    }
  }

  function handleClose() {
    setForm({ ...INITIAL_FORM });
    setShowMore(false);
    setErrors({});
    setLinkedinInput('');
    setEnrichResult(null);
    setEnrichedFields(new Set());
    onClose();
  }

  const fieldHighlight = (field: string) =>
    enrichedFields.has(field)
      ? 'ring-1 ring-[#1ED4A7]/40 border-[#1ED4A7]/30'
      : '';

  return createPortal(
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-[99999] p-0 sm:p-4" onClick={handleClose}>
      <div
        className="bg-white dark:bg-zinc-900 w-full sm:max-w-lg flex flex-col modal-as-bottom-sheet sm:rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile drag handle */}
        <div className="sm:hidden flex justify-center pt-2 pb-0">
          <div className="w-10 h-1 rounded-full bg-zinc-300 dark:bg-zinc-600" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-2.5 sm:py-4 border-b border-zinc-200 dark:border-zinc-800 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-zinc-900 dark:bg-white/10 flex items-center justify-center flex-shrink-0">
              <UserPlus className="w-4 h-4 sm:w-5 sm:h-5 text-white dark:text-zinc-300" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-semibold text-zinc-900 dark:text-white">{t('addLeadModal.title')}</h2>
              <p className="text-xs text-zinc-500 hidden sm:block">{t('addLeadModal.subtitle')}</p>
            </div>
          </div>
          <IconButton onClick={handleClose} title="Close" aria-label="Close" className="tap-target-override">
            <X />
          </IconButton>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto overscroll-contain custom-scrollbar px-4 sm:px-6 py-3 sm:py-5 space-y-3.5 sm:space-y-5 mobile-form-container">

            {/* LinkedIn Auto-Fill Section */}
            <div className="relative">
              <div className="flex items-center gap-2 mb-2.5">
                <div className="flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-[#1ED4A7]" />
                  <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">{t('addLeadModal.quickAdd')}</span>
                </div>
                <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-800" />
              </div>
              <div className="relative">
                <Linkedin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#0A66C2]" />
                <input
                  ref={linkedinInputRef}
                  type="text"
                  placeholder={t('addLeadModal.pasteLinkedIn')}
                  value={linkedinInput}
                  onChange={(e) => handleLinkedinChange(e.target.value)}
                  onPaste={handleLinkedinPaste}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      enrichFromLinkedIn();
                    }
                  }}
                  disabled={enriching}
                  className={`w-full pl-9 pr-24 py-3 sm:py-2.5 bg-zinc-50 dark:bg-zinc-800 border rounded-xl text-sm text-zinc-900 dark:text-white placeholder-zinc-400 transition-all min-h-[44px] ${
                    enrichResult === 'success'
                      ? 'border-[#1ED4A7]/50 ring-1 ring-[#1ED4A7]/20'
                      : enrichResult === 'error'
                        ? 'border-zinc-500/50 ring-1 ring-zinc-500/20'
                        : 'border-zinc-200 dark:border-zinc-700 focus:border-[#0A66C2]/50 focus:ring-1 focus:ring-[#0A66C2]/20'
                  }`}
                  autoFocus
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                  {enriching ? (
                    <span className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-500" />
                      <span className="hidden sm:inline">{t('addLeadModal.deepEnriching')}</span>
                    </span>
                  ) : enrichResult === 'success' ? (
                    <span className="flex items-center gap-1 text-[11px] text-[#1ED4A7] font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">{t('addLeadModal.filled')}</span>
                    </span>
                  ) : linkedinInput && isLinkedInUrl(linkedinInput) ? (
                    <button
                      type="button"
                      onClick={() => enrichFromLinkedIn()}
                      className="flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium text-white bg-zinc-900 dark:bg-white dark:text-zinc-900 rounded-md hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors tap-target-override min-h-[36px]"
                    >
                      <Sparkles className="w-3 h-3" />
                      <span className="hidden sm:inline">{t('addLeadModal.enrich')}</span>
                    </button>
                  ) : null}
                </div>
              </div>

              <AnimatePresence>
                {enrichResult === 'error' && enrichError && (
                  <motion.p
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center gap-1 text-xs text-zinc-400 mt-1.5"
                  >
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    {enrichError}
                  </motion.p>
                )}
                {enrichResult === 'success' && (
                  <motion.p
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="text-[11px] text-zinc-400 mt-1.5"
                  >
                    {t('addLeadModal.fieldsAutoFilled', { count: enrichedFields.size })}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>

            {/* Divider between quick add and manual */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-800" />
              <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">{t('addLeadModal.details')}</span>
              <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-800" />
            </div>

            {/* Contact Info Section */}
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-3">
                <User className="w-3.5 h-3.5" /> {t('addLeadModal.contactInfo')}
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <input
                    type="text"
                    placeholder={t('addLeadModal.firstName')}
                    value={form.first_name}
                    onChange={(e) => updateField('first_name', e.target.value)}
                    className={`w-full px-4 py-3 sm:py-2.5 bg-zinc-50 dark:bg-zinc-800 border rounded-xl text-sm text-zinc-900 dark:text-white placeholder-zinc-400 transition-all min-h-[44px] ${errors.first_name ? 'border-zinc-500' : `border-zinc-200 dark:border-zinc-700 ${fieldHighlight('first_name')}`}`}
                  />
                </div>
                <div>
                  <input
                    type="text"
                    placeholder={t('addLeadModal.lastName')}
                    value={form.last_name}
                    onChange={(e) => updateField('last_name', e.target.value)}
                    className={`w-full px-4 py-3 sm:py-2.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm text-zinc-900 dark:text-white placeholder-zinc-400 transition-all min-h-[44px] ${fieldHighlight('last_name')}`}
                  />
                </div>
                {errors.first_name && (
                  <p className="col-span-1 sm:col-span-2 text-xs text-zinc-400 -mt-1">{errors.first_name}</p>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 mt-3">
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                  <input
                    type="email"
                    placeholder={t('addLeadModal.emailAddress')}
                    value={form.email}
                    onChange={(e) => updateField('email', e.target.value)}
                    className={`w-full pl-9 pr-3 py-3 sm:py-2.5 bg-zinc-50 dark:bg-zinc-800 border rounded-xl text-sm text-zinc-900 dark:text-white placeholder-zinc-400 transition-all min-h-[44px] ${errors.email ? 'border-zinc-500' : `border-zinc-200 dark:border-zinc-700 ${fieldHighlight('email')}`}`}
                  />
                  {errors.email && <p className="text-xs text-zinc-400 mt-1">{errors.email}</p>}
                </div>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                  <input
                    type="tel"
                    placeholder="+1 (555) 123-4567"
                    value={form.phone}
                    onChange={(e) => updateField('phone', formatPhoneInput(e.target.value))}
                    className={`w-full pl-9 pr-3 py-3 sm:py-2.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm text-zinc-900 dark:text-white placeholder-zinc-400 transition-all min-h-[44px] ${fieldHighlight('phone')}`}
                  />
                </div>
              </div>
            </div>

            {/* Company Section */}
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-3">
                <Building className="w-3.5 h-3.5" /> {t('addLeadModal.company')}
              </label>
              <div className="grid grid-cols-1 gap-3">
                <div className="relative">
                  <Building className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                  <input
                    type="text"
                    placeholder={t('addLeadModal.companyName')}
                    value={form.business_name}
                    onChange={(e) => updateField('business_name', e.target.value)}
                    className={`w-full pl-9 pr-3 py-3 sm:py-2.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm text-zinc-900 dark:text-white placeholder-zinc-400 transition-all min-h-[44px] ${fieldHighlight('business_name')}`}
                  />
                </div>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                  <input
                    type="text"
                    placeholder={t('addLeadModal.website')}
                    value={form.website}
                    onChange={(e) => updateField('website', e.target.value)}
                    className={`w-full pl-9 pr-3 py-3 sm:py-2.5 bg-zinc-50 dark:bg-zinc-800 border rounded-xl text-sm text-zinc-900 dark:text-white placeholder-zinc-400 transition-all min-h-[44px] ${errors.website ? 'border-zinc-500' : `border-zinc-200 dark:border-zinc-700 ${fieldHighlight('website')}`}`}
                  />
                  {errors.website && <p className="text-xs text-zinc-400 mt-1">{errors.website}</p>}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 mt-3">
                <div className="relative">
                  <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                  <input
                    type="text"
                    placeholder={t('addLeadModal.jobTitle')}
                    value={form.job_title}
                    onChange={(e) => updateField('job_title', e.target.value)}
                    className={`w-full pl-9 pr-3 py-3 sm:py-2.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm text-zinc-900 dark:text-white placeholder-zinc-400 transition-all min-h-[44px] ${fieldHighlight('job_title')}`}
                  />
                </div>
                <input
                  type="text"
                  placeholder={t('addLeadModal.industry')}
                  value={form.industry}
                  onChange={(e) => updateField('industry', e.target.value)}
                  className={`w-full px-4 py-3 sm:py-2.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm text-zinc-900 dark:text-white placeholder-zinc-400 transition-all min-h-[44px] ${fieldHighlight('industry')}`}
                />
              </div>
            </div>

            {/* Stage Selector */}
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-3">
                {t('addLeadModal.stage')}
              </label>
              <div className="mobile-chip-group flex flex-wrap gap-2">
                {STAGE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => updateField('stage', opt.value)}
                    className={`mobile-chip px-3 sm:px-3 py-2 rounded-xl text-xs font-medium transition-all border-2 tap-target-override ${
                      form.stage === opt.value
                        ? 'border-[#1ED4A7] bg-[#1ED4A7]/10 text-[#1ED4A7]'
                        : 'bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-700'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Expandable Additional Details */}
            <div>
              <button
                type="button"
                onClick={() => setShowMore(!showMore)}
                className="flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors w-full"
              >
                {showMore ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                <span>{showMore ? t('addLeadModal.lessDetails') : t('addLeadModal.moreDetails')}</span>
                <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-800" />
              </button>

              {showMore && (
                <div className="mt-4 space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
                  {/* Location */}
                  <div>
                    <label className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-3">
                      <MapPin className="w-3.5 h-3.5" /> {t('addLeadModal.location')}
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <input
                        type="text"
                        placeholder={t('addLeadModal.city')}
                        value={form.city}
                        onChange={(e) => updateField('city', e.target.value)}
                        className={`w-full px-3 py-2.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-white placeholder-zinc-400 transition-all ${fieldHighlight('city')}`}
                      />
                      <input
                        type="text"
                        placeholder={t('addLeadModal.state')}
                        value={form.state}
                        onChange={(e) => updateField('state', e.target.value)}
                        className={`w-full px-3 py-2.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-white placeholder-zinc-400 transition-all ${fieldHighlight('state')}`}
                      />
                      <input
                        type="text"
                        placeholder={t('addLeadModal.country')}
                        value={form.country}
                        onChange={(e) => updateField('country', e.target.value)}
                        className={`w-full px-3 py-2.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-white placeholder-zinc-400 transition-all ${fieldHighlight('country')}`}
                      />
                    </div>
                  </div>

                  {/* LinkedIn (readonly if enriched) */}
                  <div>
                    <label className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-3">
                      <Linkedin className="w-3.5 h-3.5" /> {t('addLeadModal.social')}
                    </label>
                    <div className="relative">
                      <Linkedin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                      <input
                        type="text"
                        placeholder={t('addLeadModal.linkedinProfileUrl')}
                        value={form.linkedin}
                        onChange={(e) => updateField('linkedin', e.target.value)}
                        className={`w-full pl-9 pr-3 py-2.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-white placeholder-zinc-400 transition-all ${fieldHighlight('linkedin')}`}
                      />
                    </div>
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-3">
                      <StickyNote className="w-3.5 h-3.5" /> {t('addLeadModal.notes')}
                    </label>
                    <textarea
                      placeholder={t('addLeadModal.notesPlaceholder')}
                      value={form.notes}
                      onChange={(e) => updateField('notes', e.target.value)}
                      rows={3}
                      className="w-full px-3 py-2.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-white placeholder-zinc-400 transition-all resize-none"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex-shrink-0 px-4 sm:px-6 py-3 sm:py-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-4 keyboard-aware-footer">
            <p className="text-[11px] text-zinc-400 mb-2 sm:hidden text-center">
              {form.email ? t('common.existingLeadsSkipped') : t('common.addContactDetails')}
            </p>
            <div className="flex items-center gap-2 sm:gap-3">
              <p className="hidden sm:block text-xs text-zinc-400 flex-1 min-w-0 truncate">
                {form.email ? t('common.existingLeadsSkipped') : t('common.addContactDetails')}
              </p>
              <button
                type="button"
                onClick={handleClose}
                className="flex-1 sm:flex-none px-4 py-3 sm:py-2 min-h-[44px] text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-colors tap-target-override"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 sm:flex-none px-5 py-3 sm:py-2 min-h-[44px] text-sm font-semibold bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-xl hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 whitespace-nowrap tap-target-override"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t('addLeadModal.saving')}
                  </>
                ) : (
                  <>
                    <UserPlus className="w-4 h-4" />
                    {t('addLeadModal.addLead')}
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}