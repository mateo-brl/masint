; Compléments NSIS pour l'installeur Windows de MASINT (inclus par electron-builder,
; voir nsis.include dans electron-builder.yml). Fichier lu en UTF-8.
;
; À la désinstallation manuelle, propose de supprimer aussi les enquêtes et les
; réglages (%APPDATA%\MASINT). Rien n'est demandé ni supprimé lors d'une mise à
; jour automatique ou d'une désinstallation silencieuse (/S).

; 1033 : anglais (États-Unis), 1036 : français
LangString masintDeleteDataPrompt 1033 "Also delete your investigations, API keys and settings?$\r$\n$\r$\nThey are stored in $APPDATA\${APP_FILENAME}. Answer No to keep them for a future installation."
LangString masintDeleteDataPrompt 1036 "Supprimer aussi vos enquêtes, clés API et réglages ?$\r$\n$\r$\nIls sont stockés dans $APPDATA\${APP_FILENAME}. Répondez Non pour les conserver en vue d'une future installation."

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ${ifNot} ${Silent}
      ; Les données d'Electron sont toujours dans le profil de l'utilisateur courant.
      SetShellVarContext current
      ${if} ${FileExists} "$APPDATA\${APP_FILENAME}\*.*"
        MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "$(masintDeleteDataPrompt)" /SD IDNO IDNO masintKeepData
          RMDir /r "$APPDATA\${APP_FILENAME}"
          !ifdef APP_PRODUCT_FILENAME
            RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}"
          !endif
          !ifdef APP_PACKAGE_NAME
            RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
          !endif
        masintKeepData:
      ${endIf}
      ${if} $installMode == "all"
        SetShellVarContext all
      ${endIf}
    ${endIf}
  ${endIf}
!macroend
