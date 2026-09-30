import { Link, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FileQuestion } from 'lucide-react';

import { Button } from '@/components/ui/Button.jsx';
import { SectionLoader } from '@/components/ui/Spinner.jsx';
import { RichText } from '@/components/common/RichText.jsx';
import { Seo } from '@/components/seo/Seo.jsx';
import { apiClient } from '@/services/apiClient.js';
import { useResource } from '@/features/catalog/catalog.api.js';
import { EVENTS, useRealtimeEvent } from '@/services/realtime.js';
import { ROUTES } from '@/constants/routes.js';
import { mediaUrl } from '@/lib/media.js';
import { fadeUp } from '@/lib/motion.js';

/**
 * A page the owner wrote in Website → Pages — /p/:slug
 * ---------------------------------------------------------------------------
 * Only published pages are served by the API; a draft is a 404 here, not a page
 * hidden behind an unguessable address. Edits appear live while it is open.
 */
export function PageView() {
  const { slug } = useParams();
  const { data: page, isLoading, error, reload } = useResource(() => apiClient.get(`/pages/${slug}`), [slug]);

  useRealtimeEvent('guest', EVENTS.PAGES_CHANGED, reload);

  if (isLoading && !page) return <SectionLoader label="Loading page" />;

  if (error || !page) {
    return (
      <div className="container flex min-h-[50vh] flex-col items-center justify-center gap-3 py-16 text-center">
        <Seo title="Page not found" noindex />
        <FileQuestion className="h-10 w-10 text-gold" aria-hidden="true" />
        <h1 className="text-2xl font-bold">This page isn&apos;t available</h1>
        <p className="max-w-md text-muted-foreground">It may have been moved or unpublished.</p>
        <Button as={Link} to={ROUTES.HOME}>
          Back to the homepage
        </Button>
      </div>
    );
  }

  return (
    <article>
      <Seo
        title={page.title}
        description={page.seoDescription || page.subtitle || undefined}
        image={page.heroImage ? mediaUrl(page.heroImage) : undefined}
      />

      <header className="relative flex min-h-[220px] items-center justify-center overflow-hidden sm:min-h-[300px]">
        {page.heroImage && (
          <>
            <img
              src={mediaUrl(page.heroImage)}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-background/72" />
          </>
        )}
        <motion.div {...fadeUp} className="container relative py-12 text-center">
          <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">{page.title}</h1>
          {page.subtitle && (
            <p className="mx-auto mt-3 max-w-2xl text-muted-foreground sm:text-lg">{page.subtitle}</p>
          )}
          <div className="mx-auto mt-5 h-px w-24 fb-gold-rule" />
        </motion.div>
      </header>

      <div className="container max-w-3xl py-10 sm:py-14">
        <RichText source={page.body} className="text-base sm:text-[17px]" />
      </div>
    </article>
  );
}

export default PageView;
