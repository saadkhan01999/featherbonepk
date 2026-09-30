import { Link } from 'react-router-dom';
import { ExternalLink, FileText, Image as ImageIcon, Info, Mail } from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { SettingsEditor } from '@/components/admin/settings/SettingsEditor.jsx';
import { ROUTES } from '@/constants/routes.js';

/**
 * Website Management — everything a customer sees.
 * ---------------------------------------------------------------------------
 *   Business details   name, tagline, logo, address, phone, email, hours
 *   Theme              brand colour + light/dark for the website, back office,
 *                      till and kitchen screens, with a live preview
 *   Homepage           hero, story video
 *   About page         heading, text, picture, figures and any number of story
 *                      blocks ("Our Kitchen", "Our Promise"…)
 *   Contact page       heading, intro, message form on/off, map location
 *   Footer & social    blurb, copyright, any number of social icons, extra
 *                      links, and custom fields (your own label/value pairs,
 *                      shown in the footer and/or on the Contact page)
 *
 * Plus your own pages (Privacy, Catering, FAQ…) under Pages.
 *
 * Operational settings — tax, tills, receipts, kitchen — are in Settings. The
 * split keeps copy edits away from the field that can mis-price the menu.
 * Every save is live on the website immediately.
 */

const ORDER = ['business', 'hours', 'slider', 'theme', 'content', 'about', 'contact', 'footer'];

export function WebsiteManagementPage() {
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Website Management</h1>
          <p className="text-sm text-muted-foreground">
            Your logo, colours, words and pictures — live on the website the moment you save.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button as={Link} to={ROUTES.ADMIN_PAGES} variant="secondary" leftIcon={FileText}>
            Pages
          </Button>
          <Button as={Link} to={ROUTES.ADMIN_OFFERS} variant="secondary" leftIcon={ImageIcon}>
            Offers &amp; banners
          </Button>
          <Button
            as="a"
            variant="outline"
            href={ROUTES.HOME}
            target="_blank"
            rel="noreferrer"
            leftIcon={ExternalLink}
          >
            View site
          </Button>
        </div>
      </header>

      <SettingsEditor
        group="website"
        order={ORDER}
        extras={{
          slider: (
            <Hint icon={ImageIcon}>
              Up to five slides. Upload landscape pictures (about 1920 × 900); the words sit on a dark shade
              so any photo stays readable. With no slides here, the homepage uses the hero from Website
              Content.{' '}
              <a href={ROUTES.HOME} target="_blank" rel="noreferrer" className="text-gold hover:underline">
                See the homepage
              </a>
            </Hint>
          ),
          about: (
            <Hint icon={Info}>
              The About page shows your heading and text, the picture, the figures you fill in (blank ones are
              hidden), then each story block in order.{' '}
              <a href={ROUTES.ABOUT} target="_blank" rel="noreferrer" className="text-gold hover:underline">
                Open About Us
              </a>
            </Hint>
          ),
          contact: (
            <Hint icon={Mail}>
              Address, phone, email and hours come from Business details. Custom fields marked “Show on
              Contact page” (in Footer &amp; Social) are listed there too.{' '}
              <a href={ROUTES.CONTACT} target="_blank" rel="noreferrer" className="text-gold hover:underline">
                Open Contact Us
              </a>
            </Hint>
          ),
          footer: (
            <Hint icon={FileText}>
              Published pages marked “Link in the footer” are added automatically — manage them under{' '}
              <Link to={ROUTES.ADMIN_PAGES} className="text-gold hover:underline">
                Pages
              </Link>
              .
            </Hint>
          ),
        }}
      />
    </div>
  );
}

function Hint({ icon: Icon, children }) {
  return (
    <p className="mx-5 mb-4 flex items-start gap-2 rounded-xl border border-info/30 bg-info/5 px-3 py-2.5 text-xs text-muted-foreground">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

export default WebsiteManagementPage;
