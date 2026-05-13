import PublicHeader from '@/components/layout/public-header';
import PublicFooter from '@/components/layout/public-footer';
import { Mail, Phone, MapPin } from 'lucide-react';

export const metadata = {
  title: 'Contact — InvestorPilot',
  description: 'Contact Corporate AI Solutions, makers of InvestorPilot.',
};

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-dark-950 flex flex-col">
      <PublicHeader />

      <main className="flex-1 max-w-3xl mx-auto px-6 py-16 w-full">
        <h1 className="mb-2">Contact</h1>
        <p className="text-dark-400 mb-10">
          For product enquiries, support, or compliance correspondence.
        </p>

        <div className="space-y-4">
          <div className="card flex items-start gap-4">
            <Mail className="w-5 h-5 text-corp-green-400 mt-1 flex-shrink-0" />
            <div>
              <p className="font-medium">Email</p>
              <p className="text-dark-300 mt-1">
                <a href="mailto:dennis@corporateaisolutions.com" className="hover:text-white">
                  dennis@corporateaisolutions.com
                </a>
              </p>
            </div>
          </div>

          <div className="card flex items-start gap-4">
            <Phone className="w-5 h-5 text-corp-green-400 mt-1 flex-shrink-0" />
            <div>
              <p className="font-medium">Phone</p>
              <p className="text-dark-300 mt-1">+61 402 612 471</p>
            </div>
          </div>

          <div className="card flex items-start gap-4">
            <MapPin className="w-5 h-5 text-corp-green-400 mt-1 flex-shrink-0" />
            <div>
              <p className="font-medium">Address</p>
              <p className="text-dark-300 mt-1">
                Corporate AI Solutions Pty Ltd<br />
                Australia
              </p>
              <p className="text-dark-500 text-xs mt-1">
                Full registered address to be added.
              </p>
            </div>
          </div>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
