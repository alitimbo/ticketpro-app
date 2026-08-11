!macro NSIS_HOOK_PREINSTALL
  IfFileExists "$INSTDIR\ticketpro-vpn-service.exe" 0 ticketpro_vpn_preinstall_done
  nsExec::ExecToStack '"$INSTDIR\ticketpro-vpn-service.exe" --uninstall-service'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_ICONSTOP|MB_OK "TicketPro ne peut pas arreter proprement son service VPN (code $0). Fermez TicketPro puis relancez l'installation."
    Abort
  ${EndIf}
  ticketpro_vpn_preinstall_done:
!macroend

!macro NSIS_HOOK_POSTINSTALL
  nsExec::ExecToStack '"$INSTDIR\ticketpro-vpn-service.exe" --install-service'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_ICONSTOP|MB_OK "Le service VPN securise TicketPro n'a pas pu etre installe (code $0). L'installation va etre interrompue."
    Abort
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  IfFileExists "$INSTDIR\ticketpro-vpn-service.exe" 0 ticketpro_vpn_preuninstall_done
  nsExec::ExecToStack '"$INSTDIR\ticketpro-vpn-service.exe" --uninstall-service'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_ICONSTOP|MB_OK "TicketPro ne peut pas retirer proprement son service VPN (code $0). L'application ne sera pas supprimee."
    Abort
  ${EndIf}
  ticketpro_vpn_preuninstall_done:
!macroend
