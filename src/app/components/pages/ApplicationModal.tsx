import { motion, AnimatePresence } from 'motion/react';
import { X, Upload, Check, Loader2, AlertCircle } from 'lucide-react';
import { useState, useRef } from 'react';
import { projectId } from '../../utils/supabase/info';

interface ApplicationModalProps {
  isOpen: boolean;
  onClose: () => void;
  roleTitle: string;
}

export function ApplicationModal({ isOpen, onClose, roleTitle }: ApplicationModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    linkedin: '',
    notes: ''
  });
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const data = new FormData();
      data.append('name', formData.name);
      data.append('email', formData.email);
      data.append('linkedin', formData.linkedin);
      data.append('notes', formData.notes);
      data.append('role', roleTitle);
      if (resumeFile) data.append('resume', resumeFile);

      const response = await fetch(`https://${projectId}.supabase.co/functions/v1/make-server-a8b2511f/careers/apply`, {
        method: 'POST',
        body: data,
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || 'Failed to submit application');
      }

      setIsSuccess(true);
      setTimeout(() => {
        onClose();
        setTimeout(() => {
          setIsSuccess(false);
          setFormData({ name: '', email: '', linkedin: '', notes: '' });
          setResumeFile(null);
        }, 300);
      }, 2000);
    } catch (err: any) {
      console.error('Application error:', err);
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) setResumeFile(e.target.files[0]);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 sm:px-6">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 20 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-lg bg-[#0A0A0A] border border-white/[0.08] rounded-[2rem] shadow-2xl overflow-hidden"
          >
            {isSuccess ? (
              <div className="p-14 flex flex-col items-center justify-center text-center">
                <div className="w-14 h-14 bg-emerald-500/10 rounded-full flex items-center justify-center mb-6">
                  <Check className="w-6 h-6 text-emerald-400/80" />
                </div>
                <h3 className="text-xl font-semibold text-white mb-2 tracking-tight">Application Received</h3>
                <p className="text-sm text-zinc-500">Thanks for applying to {roleTitle}. We'll be in touch soon.</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between p-7 border-b border-white/[0.06]">
                  <div>
                    <h3 className="text-base font-semibold text-white tracking-tight">Apply for {roleTitle}</h3>
                    <p className="text-xs text-zinc-600 mt-0.5">Complete the form below</p>
                  </div>
                  <button
                    onClick={onClose}
                    className="p-2 hover:bg-white/[0.04] rounded-xl transition-colors text-zinc-500 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="p-7 space-y-4 max-h-[70vh] overflow-y-auto custom-scrollbar">
                  {error && (
                    <div className="p-3.5 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-2.5 text-red-400 text-xs">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <p>{error}</p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Full Name</label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={e => setFormData({...formData, name: e.target.value})}
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3.5 text-sm text-white focus:outline-none focus:border-white/20 focus:ring-1 focus:ring-white/10 transition-all placeholder:text-zinc-700"
                      placeholder="Jane Doe"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Email Address</label>
                    <input
                      type="email"
                      required
                      value={formData.email}
                      onChange={e => setFormData({...formData, email: e.target.value})}
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3.5 text-sm text-white focus:outline-none focus:border-white/20 focus:ring-1 focus:ring-white/10 transition-all placeholder:text-zinc-700"
                      placeholder="jane@example.com"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">LinkedIn / Portfolio</label>
                    <input
                      type="url"
                      required
                      value={formData.linkedin}
                      onChange={e => setFormData({...formData, linkedin: e.target.value})}
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3.5 text-sm text-white focus:outline-none focus:border-white/20 focus:ring-1 focus:ring-white/10 transition-all placeholder:text-zinc-700"
                      placeholder="https://linkedin.com/in/..."
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Resume / CV</label>
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className={`border border-dashed rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer transition-all duration-300 ${
                        resumeFile
                          ? 'bg-white/[0.04] border-white/20'
                          : 'border-white/[0.08] hover:border-white/[0.15] hover:bg-white/[0.02]'
                      }`}
                    >
                      <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileChange}
                        className="hidden"
                        accept=".pdf,.doc,.docx"
                      />
                      {resumeFile ? (
                        <div className="text-center">
                          <Check className="w-5 h-5 text-white mx-auto mb-2" />
                          <p className="text-xs font-semibold text-white truncate max-w-[200px]">{resumeFile.name}</p>
                          <p className="text-[10px] text-zinc-600 mt-1">Click to replace</p>
                        </div>
                      ) : (
                        <div className="text-center">
                          <Upload className="w-5 h-5 text-zinc-600 mx-auto mb-2" />
                          <p className="text-xs font-medium text-zinc-400">Click to upload</p>
                          <p className="text-[10px] text-zinc-600 mt-1">PDF, DOC, DOCX up to 5MB</p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Additional Notes</label>
                    <textarea
                      value={formData.notes}
                      onChange={e => setFormData({...formData, notes: e.target.value})}
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3.5 text-sm text-white focus:outline-none focus:border-white/20 focus:ring-1 focus:ring-white/10 transition-all placeholder:text-zinc-700 min-h-[100px]"
                      placeholder="Tell us a bit about yourself..."
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full py-4 rounded-2xl bg-white text-black font-semibold hover:bg-zinc-200 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed mt-3 shadow-[0_0_40px_-10px_rgba(255,255,255,0.1)]"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      'Submit Application'
                    )}
                  </button>
                </form>
              </>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}