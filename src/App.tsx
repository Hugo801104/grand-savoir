import { useEffect } from 'react';
import { ToastHost } from './components/ui';
import { useRoute } from './lib/router';
import { init, useApp } from './lib/store';
import { Admin } from './screens/Admin';
import { Categories, CategoryDetail, Custom } from './screens/Categories';
import { Discovery } from './screens/Discovery';
import { Game } from './screens/Game';
import { Home } from './screens/Home';
import { Results } from './screens/Results';
import { MyReports, SettingsScreen } from './screens/Settings';
import { History, QuestionDetail, Stats } from './screens/Stats';

export function App() {
  const route = useRoute();
  const { ready, content, contentError, settings } = useApp();

  useEffect(() => {
    void init();
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('reduced', settings.reducedMotion);
  }, [settings.reducedMotion]);

  if (!content) {
    return (
      <div className="app loading">
        {contentError ? (
          <div>
            <p className="logo">Le Grand Savoir</p>
            <p className="notice warn" style={{ marginTop: 16 }}>
              Impossible de télécharger les questions ({contentError}). Vérifie ta connexion : une fois chargées, elles restent
              disponibles hors-ligne.
            </p>
            <button className="btn primary" style={{ marginTop: 16 }} onClick={() => location.reload()}>
              Réessayer
            </button>
          </div>
        ) : (
          <div>
            <div className="spinner" style={{ margin: '0 auto' }} />
            <p className="muted" style={{ marginTop: 12 }}>{ready ? '' : 'Chargement…'}</p>
          </div>
        )}
      </div>
    );
  }

  const [, seg, arg] = route.path.split('/');
  let screen;
  switch (seg) {
    case 'jouer':
      // la clé force une nouvelle partie à chaque lancement
      screen = <Game key={route.path + JSON.stringify(route.params)} route={route} />;
      break;
    case 'resultats':
      screen = <Results />;
      break;
    case 'categories':
      screen = <Categories />;
      break;
    case 'categorie':
      screen = <CategoryDetail id={decodeURIComponent(arg ?? '')} />;
      break;
    case 'perso':
      screen = <Custom route={route} />;
      break;
    case 'decouverte':
      screen = <Discovery id={arg ? decodeURIComponent(arg) : undefined} />;
      break;
    case 'stats':
      screen = <Stats />;
      break;
    case 'historique':
      screen = <History />;
      break;
    case 'question':
      screen = <QuestionDetail id={decodeURIComponent(arg ?? '')} />;
      break;
    case 'signalements':
      screen = <MyReports />;
      break;
    case 'reglages':
      screen = <SettingsScreen />;
      break;
    case 'admin':
      screen = <Admin />;
      break;
    default:
      screen = <Home />;
  }
  return (
    <>
      {screen}
      <ToastHost />
    </>
  );
}
