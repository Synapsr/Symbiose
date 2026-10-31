import { ArrowRight, GitHub } from '../components/Icons';
import { Logo } from '../components/Logo';
import { Wordmark } from '../components/Wordmark';
import { REPO } from '../i18n';
import { useLang } from '../lang';
import './Footer.css';

export function Footer() {
  const { t } = useLang();
  const f = t.footer;
  const links = [
    [REPO, f.github],
    [`${REPO}/blob/main/docs/architecture.md`, f.architecture],
    [`${REPO}/blob/main/CONTRIBUTING.md`, f.contributing],
    [`${REPO}/blob/main/LICENSE`, f.license],
  ] as const;
  return (
    <footer className="footer">
      <div className="wrap">
        <div className="footer-cta" data-reveal>
          <Logo size={64} animate="inview" breathe />
          <p className="footer-title">
            <span>{f.title1}</span> <span className="accent-italic">{f.title2}</span>
          </p>
          <div className="footer-buttons">
            <a className="btn btn--primary btn--icon-end" href="#self-host">
              {f.cta}
              <ArrowRight size={18} />
            </a>
            <a className="btn btn--secondary btn--icon-start" href={REPO}>
              <GitHub size={18} />
              GitHub
            </a>
          </div>
        </div>

        <div className="footer-bottom">
          <div className="footer-brand">
            <Logo size={24} />
            <Wordmark height={21} />
          </div>
          <nav className="footer-links" aria-label="Symbiose">
            {links.map(([href, label]) => (
              <a key={href} href={href}>
                {label}
              </a>
            ))}
            <a href="#top">{f.top}</a>
          </nav>
          <p className="footer-legal">
            {f.disclaimer} {f.made}
          </p>
        </div>
      </div>
    </footer>
  );
}
