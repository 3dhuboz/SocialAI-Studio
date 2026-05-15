import React, { useState } from 'react';
import { CLIENT } from '../client.config';
import { X, Send, Facebook, CheckCircle, ChevronRight } from 'lucide-react';

interface ClientIntakeFormProps {
  userEmail: string;
  onClose: () => void;
  onSubmitted: () => void;
}

export const ClientIntakeForm: React.FC<ClientIntakeFormProps> = ({ userEmail, onClose, onSubmitted }) => {
  const [step, setStep] = useState<'form' | 'sent' | 'error'>('form');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [form, setForm] = useState({
    contactName: '',
    phone: '',
    businessName: '',
    businessType: '',
    location: '',
    facebookPageUrl: '',
    facebookPageName: '',
    facebookPageId: '',
    instagramHandle: '',
    followers: '',
    chosenPlan: 'Starter',
    notes: '',
  });

  const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [field]: e.target.value }));

  const handleSend = async () => {
    setIsSending(true);
    setSendError('');
    try {
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'intake-notify',
          name: form.contactName,
          email: userEmail,
          phone: form.phone || '',
          businessName: form.businessName,
          businessType: form.businessType || '',
          plan: form.chosenPlan,
          message: [
            form.location ? `Location: ${form.location}` : '',
            form.facebookPageUrl ? `Facebook: ${form.facebookPageUrl}` : '',
            form.facebookPageName ? `Page name: ${form.facebookPageName}` : '',
            form.facebookPageId ? `Page ID: ${form.facebookPageId}` : '',
            form.instagramHandle ? `Instagram: ${form.instagramHandle}` : '',
            form.followers ? `Followers: ${form.followers}` : '',
            form.notes ? `Notes: ${form.notes}` : '',
          ].filter(Boolean).join('\n'),
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Send failed');
      setStep('sent');
      onSubmitted();
    } catch (e: any) {
      console.warn('send-email failed, using mailto fallback:', e.message);
      fallbackMailto();
      setStep('sent');
      onSubmitted();
    } finally {
      setIsSending(false);
    }
  };

  const fallbackMailto = () => {
    const body = `NEW CLIENT SETUP REQUEST — SocialAI Studio\n\nContact: ${form.contactName}\nEmail: ${userEmail}\nPhone: ${form.phone || 'Not provided'}\n\nBusiness: ${form.businessName}\nType: ${form.businessType || 'Not provided'}\nLocation: ${form.location || 'Not provided'}\n\nFacebook URL: ${form.facebookPageUrl}\nFacebook Page Name: ${form.facebookPageName || 'Not provided'}\nFacebook Page ID: ${form.facebookPageId || 'Not provided'}\nInstagram: ${form.instagramHandle || 'Not provided'}\nFollowers: ${form.followers || 'Unknown'}\n\nChosen Plan: ${form.chosenPlan}\n\nNotes:\n${form.notes || 'None'}`;
    const subject = encodeURIComponent(`New Client Setup Request — ${form.businessName}`);
    window.open(`mailto:${CLIENT.supportEmail}?subject=${subject}&body=${encodeURIComponent(body)}`, '_blank');
  };

  const isValid = form.contactName.trim() && form.businessName.trim() && form.facebookPageUrl.trim();

  if (step === 'sent') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)' }}>
        <div className="bg-[#0e0e1a] border border-green-500/25 rounded-3xl p-8 max-w-md w-full text-center space-y-5 shadow-2xl">
          <div className="w-16 h-16 mx-auto bg-green-500/15 border border-green-500/25 rounded-2xl flex items-center justify-center">
            <CheckCircle size={28} className="text-green-400" />
          </div>
          <div>
            <h2 className="text-xl font-black text-white">Setup Request Sent!</h2>
            <p className="text-sm text-white/50 mt-2 leading-relaxed">
              Your details have been sent to our setup team at <span className="text-amber-400">{CLIENT.supportEmail}</span>.
              We'll contact you within 1 business day to arrange payment of the $99 setup fee and connect your Facebook page.
            </p>
          </div>
          <div className="bg-amber-500/8 border border-amber-500/20 rounded-2xl p-4 text-left space-y-2">
            <p className="text-xs font-bold text-amber-300">What happens next:</p>
            <ul className="text-xs text-white/50 space-y-1.5">
              <li className="flex items-start gap-2"><ChevronRight size={12} className="text-amber-400 shrink-0 mt-0.5" /> We'll email you an invoice for the $99 once-off setup fee</li>
              <li className="flex items-start gap-2"><ChevronRight size={12} className="text-amber-400 shrink-0 mt-0.5" /> We connect your Facebook Page and configure your account</li>
              <li className="flex items-start gap-2"><ChevronRight size={12} className="text-amber-400 shrink-0 mt-0.5" /> Your AI content calendar goes live — you're up and running!</li>
            </ul>
          </div>
          <button onClick={onClose} className="w-full bg-gradient-to-r from-amber-500 to-orange-500 text-black font-black py-3 rounded-2xl transition hover:opacity-90">
            Got it — let's go!
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto" style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)' }}>
      <div className="bg-[#0e0e1a] border border-white/10 rounded-3xl w-full max-w-[calc(100vw-1rem)] sm:max-w-2xl shadow-2xl my-4">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/[0.08]">
          <div>
            <h2 className="text-lg font-black text-white">Complete Your Setup</h2>
            <p className="text-xs text-white/40 mt-0.5">Tell us about your business so we can connect your Facebook Page</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/40 hover:text-white/70 transition">
            <X size={15} />
          </button>
        </div>

        {/* Setup Fee Banner */}
        <div className="mx-6 mt-5 bg-amber-500/8 border border-amber-500/20 rounded-2xl px-4 py-3.5 flex items-start gap-3">
          <div className="w-8 h-8 bg-amber-500/20 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
            <span className="text-sm">💳</span>
          </div>
          <div className="text-xs text-white/55 leading-relaxed">
            <span className="text-amber-300 font-bold">One-time setup fee: ${CLIENT.setupFee} </span>
            — includes Facebook page connection, account configuration, and a personalised AI brand profile setup. Once you submit this form, our team will send you a payment link within 1 business day.
          </div>
        </div>

        {/* Form */}
        <div className="px-6 py-5 space-y-5">

          {/* Contact details */}
          <div>
            <p className="text-[10px] font-black text-white/30 uppercase tracking-widest mb-3">Your Contact Details</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-white/40 block mb-1.5">Full Name <span className="text-red-400">*</span></label>
                <input value={form.contactName} onChange={set('contactName')} placeholder="e.g. Jane Smith"
                  className="w-full bg-black/40 border border-white/[0.08] rounded-xl px-3 py-2.5 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-amber-500/40 transition" />
              </div>
              <div>
                <label className="text-xs text-white/40 block mb-1.5">Phone Number</label>
                <input type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} placeholder="e.g. 0412 345 678"
                  className="w-full bg-black/40 border border-white/[0.08] rounded-xl px-3 py-2.5 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-amber-500/40 transition" />
              </div>
            </div>
          </div>

          {/* Business details */}
          <div>
            <p className="text-[10px] font-black text-white/30 uppercase tracking-widest mb-3">Your Business</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-white/40 block mb-1.5">Business Name <span className="text-red-400">*</span></label>
                <input value={form.businessName} onChange={set('businessName')} placeholder="e.g. Bella's Bakery"
                  className="w-full bg-black/40 border border-white/[0.08] rounded-xl px-3 py-2.5 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-amber-500/40 transition" />
              </div>
              <div>
                <label className="text-xs text-white/40 block mb-1.5">Business Type</label>
                <input value={form.businessType} onChange={set('businessType')} placeholder="e.g. Café & bakery"
                  className="w-full bg-black/40 border border-white/[0.08] rounded-xl px-3 py-2.5 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-amber-500/40 transition" />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs text-white/40 block mb-1.5">Location</label>
                <input value={form.location} onChange={set('location')} placeholder="e.g. Rockhampton, QLD"
                  className="w-full bg-black/40 border border-white/[0.08] rounded-xl px-3 py-2.5 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-amber-500/40 transition" />
              </div>
            </div>
          </div>

          {/* Facebook details */}
          <div>
            <p className="text-[10px] font-black text-white/30 uppercase tracking-widest mb-1">Facebook &amp; Instagram</p>
            <p className="text-[10px] text-white/25 mb-3">We need this to connect your page for auto-publishing</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="text-xs text-white/40 block mb-1.5 flex items-center gap-1.5"><Facebook size={11} className="text-blue-400" /> Facebook Page URL <span className="text-red-400">*</span></label>
                <input value={form.facebookPageUrl} onChange={set('facebookPageUrl')} placeholder="https://facebook.com/yourbusiness"
                  className="w-full bg-black/40 border border-white/[0.08] rounded-xl px-3 py-2.5 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-blue-500/40 transition" />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs text-white/40 block mb-1">Facebook Page ID <span className="text-amber-400/70 font-semibold">— needed for AI analytics</span></label>
                <p className="text-[10px] text-white/25 mb-1.5">Find it: go to your Facebook Page → About → scroll to the bottom, or visit <span className="text-white/40">facebook.com/yourbusiness/about</span> and look for "Page ID" (a long number like 123456789012345)</p>
                <input value={form.facebookPageId} onChange={set('facebookPageId')} placeholder="e.g. 123456789012345"
                  className="w-full bg-black/40 border border-amber-500/15 rounded-xl px-3 py-2.5 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-amber-500/40 transition" />
              </div>
              <div>
                <label className="text-xs text-white/40 block mb-1.5">Facebook Page Name</label>
                <input value={form.facebookPageName} onChange={set('facebookPageName')} placeholder="e.g. Bella's Bakery Rockhampton"
                  className="w-full bg-black/40 border border-white/[0.08] rounded-xl px-3 py-2.5 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-amber-500/40 transition" />
              </div>
              <div>
                <label className="text-xs text-white/40 block mb-1.5">Instagram Handle</label>
                <input value={form.instagramHandle} onChange={set('instagramHandle')} placeholder="@yourbusiness"
                  className="w-full bg-black/40 border border-white/[0.08] rounded-xl px-3 py-2.5 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-amber-500/40 transition" />
              </div>
              <div>
                <label className="text-xs text-white/40 block mb-1.5">Approx. Current Followers</label>
                <input value={form.followers} onChange={set('followers')} placeholder="e.g. 850"
                  className="w-full bg-black/40 border border-white/[0.08] rounded-xl px-3 py-2.5 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-amber-500/40 transition" />
              </div>
              <div>
                <label className="text-xs text-white/40 block mb-1.5">Chosen Plan</label>
                <select value={form.chosenPlan} onChange={set('chosenPlan')}
                  className="w-full bg-black/40 border border-white/[0.08] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500/40 transition">
                  {CLIENT.plans.map(p => (
                    <option key={p.id} value={p.name}>{p.name} — ${p.price}/mo</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs text-white/40 block mb-1.5">Anything else we should know?</label>
            <textarea value={form.notes} onChange={set('notes')} rows={2}
              placeholder="Special requirements, preferred contact times, existing social media challenges…"
              className="w-full bg-black/40 border border-white/[0.08] rounded-xl px-3 py-2.5 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-amber-500/40 transition resize-none" />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex flex-wrap items-center gap-3 pt-2 border-t border-white/[0.06]">
          {sendError && <p className="w-full text-xs text-amber-400 text-center">{sendError}</p>}
          <button
            onClick={handleSend}
            disabled={!isValid || isSending}
            className="flex-1 bg-gradient-to-r from-amber-500 to-orange-500 disabled:opacity-40 text-black font-black py-3 rounded-2xl flex items-center justify-center gap-2 transition hover:opacity-90 text-sm"
          >
            {isSending
              ? <><span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" /> Sending…</>
              : <><Send size={15} /> Send to Setup Team</>}
          </button>
          <button onClick={onClose} className="text-xs text-white/25 hover:text-white/50 transition px-3 py-3">
            I'll do this later
          </button>
          <p className="w-full text-[10px] text-white/20 text-center">
            Sends to <a href={`mailto:${CLIENT.supportEmail}`} className="text-white/35 hover:text-white/55 transition">{CLIENT.supportEmail}</a> · opens your email client
          </p>
        </div>
      </div>
    </div>
  );
};
