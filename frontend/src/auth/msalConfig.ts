/**
 * MSAL configuration for Azure AD authentication.
 */
import { Configuration, LogLevel } from '@azure/msal-browser';
import { config } from '../config';

export const msalConfig: Configuration = {
  auth: {
    clientId: config.authClientId,
    authority: config.authAuthority,
    redirectUri: window.location.origin,
    postLogoutRedirectUri: window.location.origin,
  },
  cache: {
    cacheLocation: 'sessionStorage',
    storeAuthStateInCookie: false,
  },
  system: {
    loggerOptions: {
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) return;
        switch (level) {
          case LogLevel.Error:
            console.error(message);
            break;
          case LogLevel.Warning:
            console.warn(message);
            break;
          case LogLevel.Info:
            console.info(message);
            break;
          case LogLevel.Verbose:
            console.debug(message);
            break;
        }
      },
      logLevel: config.isDevMode ? LogLevel.Warning : LogLevel.Error,
    },
  },
};

export const loginRequest = {
  scopes: config.msalScopes,
};

export const apiRequest = {
  scopes: config.msalScopes,
};
