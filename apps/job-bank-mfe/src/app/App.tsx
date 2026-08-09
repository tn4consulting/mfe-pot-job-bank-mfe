// `import * as React` looks unused under the `jsx: 'automatic'` transform
// (used for standalone serving, see bootstrap.tsx) -- it's required for the
// FEDERATED build path (tsconfig.federation.json, classic transform via
// React.createElement/React.Fragment), which this same file also compiles
// under. See federation.config.mjs and shared-federation-config/react's
// own comments for why the federated build can't use the automatic
// transform: react/jsx-runtime's shared chunk can't be built with correct
// named exports (a confirmed native-federation limitation, not something
// fixable from this app's config alone), and disabling
// jsx-runtime/jsx-dev-runtime auto-sharing left it externalized with no
// chunk at all rather than bundled inline. Classic transform sidesteps the
// whole problem: it only needs the (already correctly shared) 'react'
// package itself.
import * as React from 'react';
import { useEffect, useState } from 'react';
import { CLAIM_JOB_BANK, getStoredSession, hasClaim, onSessionChange } from '@tn4consulting/shared-auth/core';
import type { ContentClient, PageContent } from '@tn4consulting/shared-content-client';
import type { JobBankApiClient } from 'job-bank-data-access';
import { HttpJobBankApiClient } from 'job-bank-data-access';
import { createContentClient, INTRO_CONTENT_KEY } from './content-client';
import { loadRuntimeConfig } from '../runtime-config';
import { assetBaseUrl } from './asset-base-url';
import { useLocale, useTranslations } from '@tn4consulting/shared-i18n';
import { FeatureSearch } from './components/FeatureSearch';
import { FeatureApply } from './components/FeatureApply';
import { JobApplicationsList } from './components/JobApplicationsList';
// Registers the SCDS custom elements FeatureSearch renders -- explicit
// here too (not just via FeatureSearch's own import) since this file is
// federation.config.mjs's actual `./Component` expose target.
import '../register-scds';

interface RemoteConfig {
  apiClient: JobBankApiClient;
  contentClient: ContentClient;
}

/**
 * Does its own setup entirely -- no host-provided `REMOTE_PROVIDERS`
 * equivalent for a React remote (see RemoteRouteHost in
 * shared-federation-runtime for why: React has no DI tree for a host to
 * populate, so the exposed component just does on mount what the Angular
 * remotes' remote-providers.ts + app.config.ts collectively did).
 */
export function App() {
  // Defense in depth: this app validates its own claim independently,
  // never assuming "the shell let me navigate here, so I'm authorized" --
  // see CLAUDE.md's "Security: defense in depth" section.
  const [hasAccess, setHasAccess] = useState(() => hasClaim(getStoredSession(), CLAIM_JOB_BANK));
  const [config, setConfig] = useState<RemoteConfig | null>(null);
  const [intro, setIntro] = useState<PageContent | null>(null);
  const [introLoadError, setIntroLoadError] = useState(false);
  const locale = useLocale();
  const { t } = useTranslations(assetBaseUrl, locale);

  useEffect(() => onSessionChange((session) => setHasAccess(hasClaim(session, CLAIM_JOB_BANK))), []);

  useEffect(() => {
    let cancelled = false;
    loadRuntimeConfig(assetBaseUrl).then((runtimeConfig) => {
      if (cancelled) {
        return;
      }
      setConfig({
        apiClient: new HttpJobBankApiClient(runtimeConfig.jobBankBffBaseUrl),
        contentClient: createContentClient(runtimeConfig.strapiBaseUrl, assetBaseUrl),
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // CMS content (unlike the i18n chrome text above) isn't reactive by
  // default, so this app explicitly re-fetches whenever the cross-remote
  // active locale changes -- same pattern as dashboard's app.ts.
  useEffect(() => {
    if (!config) {
      return;
    }
    let cancelled = false;
    config.contentClient
      .getPageContent(INTRO_CONTENT_KEY, locale === 'fr' ? 'fr' : 'en')
      .then((content) => {
        if (!cancelled) {
          setIntro(content);
          setIntroLoadError(false);
        }
      })
      .catch((err) => {
        console.error('Failed to load job-bank intro content', err);
        if (!cancelled) {
          setIntroLoadError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [config, locale]);

  if (!config) {
    return null;
  }

  if (!hasAccess) {
    return <p role="alert">{t('auth.signInRequired')}</p>;
  }

  return (
    <>
      {intro ? (
        <section>
          <h1>{intro.title}</h1>
          <p>{intro.body}</p>
        </section>
      ) : introLoadError ? (
        <p role="alert">{t('errors.contentUnavailable')}</p>
      ) : null}
      <FeatureSearch apiClient={config.apiClient} contentClient={config.contentClient} locale={locale} />
      <FeatureApply apiClient={config.apiClient} contentClient={config.contentClient} locale={locale} />
      <JobApplicationsList />
    </>
  );
}
