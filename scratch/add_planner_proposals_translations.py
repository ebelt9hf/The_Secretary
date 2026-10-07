import json
import os

new_keys = {
    "planner.proposedBadge": {
        "en": "Proposed",
        "de": "Vorgeschlagen",
        "fr": "Proposé",
        "cs": "Navrženo",
        "es": "Propuesto",
        "hu": "Javasolt",
        "it": "Proposto",
        "nl": "Voorgesteld",
        "pl": "Proponowane",
        "pt": "Proposto",
        "ro": "Propus",
        "ru": "Предложено",
        "sv": "Föreslagen",
        "tr": "Önerilen",
        "uk": "Запропоновано"
    },
    "planner.proposedByAgent": {
        "en": "Proposed by Agent",
        "de": "Vom Agenten vorgeschlagen",
        "fr": "Proposé par l'agent",
        "cs": "Navrženo agentem",
        "es": "Propuesto por el agente",
        "hu": "Ügynök által javasolt",
        "it": "Proposto dall'agente",
        "nl": "Voorgesteld door agent",
        "pl": "Zaproponowane przez agenta",
        "pt": "Proposto pelo agente",
        "ro": "Propus de agent",
        "ru": "Предложено агентом",
        "sv": "Föreslagen av agent",
        "tr": "Ajan tarafından önerildi",
        "uk": "Запропоновано агентом"
    },
    "planner.proposalsLabel": {
        "en": "Proposals",
        "de": "Vorschläge",
        "fr": "Propositions",
        "cs": "Návrhy",
        "es": "Propuestas",
        "hu": "Javaslatok",
        "it": "Proposte",
        "nl": "Voorstellen",
        "pl": "Propozycje",
        "pt": "Propostas",
        "ro": "Propuneri",
        "ru": "Предложения",
        "sv": "Förslag",
        "tr": "Öneriler",
        "uk": "Пропозиції"
    },
    "planner.toggleProposalsTooltip": {
        "en": "Toggle display of agent-proposed calendar events to review",
        "de": "Anzeige von vom Agenten vorgeschlagenen Kalenderereignissen zur Überprüfung umschalten",
        "fr": "Basculer l'affichage des événements proposés par l'agent à examiner",
        "cs": "Přepnout zobrazení navržených událostí kalendáře k revizi",
        "es": "Alternar visualización de eventos de calendario propuestos por el agente para revisar",
        "hu": "Ügynök által javasolt naptáresemények megjelenítésének átváltása áttekintéshez",
        "it": "Attiva o disattiva la visualizzazione degli eventi del calendario proposti dall'agente da revisionare",
        "nl": "Schakel weergave van door agent voorgestelde agendagebeurtenissen ter beoordeling in of uit",
        "pl": "Przełącz wyświetlanie wydarzeń kalendarza zaproponowanych przez agenta do przeglądu",
        "pt": "Alternar exibição de eventos de calendário propostos pelo agente para revisão",
        "ro": "Comutați afișarea evenimentelor propuse de agent pentru revizuire",
        "ru": "Переключить отображение предложенных агентом событий календаря для проверки",
        "sv": "Växla visning av kalenderhändelser föreslagna av agent för granskning",
        "tr": "İncelemek için ajan tarafından önerilen takvim etkinliklerinin görünümünü aç/kapat",
        "uk": "Увімкнути або вимкнути відображення запропонованих агентом подій календаря для перегляду"
    },
    "planner.clickToReviewProposalTooltip": {
        "en": "Proposed by agent. Click to review and add details.",
        "de": "Vom Agenten vorgeschlagen. Klicken, um Details zu überprüfen und hinzuzufügen.",
        "fr": "Proposé par l'agent. Cliquez pour examiner et ajouter des détails.",
        "cs": "Navrženo agentem. Kliknutím zkontrolujte a doplňte podrobnosti.",
        "es": "Propuesto por el agente. Haga clic para revisar y agregar detalles.",
        "hu": "Ügynök által javasolt. Kattintson a részletek áttekintéséhez és hozzáadásához.",
        "it": "Proposto dall'agente. Fai clic per rivedere e aggiungere dettagli.",
        "nl": "Voorgesteld door agent. Klik om details te bekijken en toe te voegen.",
        "pl": "Zaproponowane przez agenta. Kliknij, aby przejrzeć i dodać szczegóły.",
        "pt": "Proposto pelo agente. Clique para revisar e adicionar detalhes.",
        "ro": "Propus de agent. Faceți clic pentru a revizui și a adăuga detalii.",
        "ru": "Предложено агентом. Нажмите для проверки и добавления подробностей.",
        "sv": "Föreslagen av agent. Klicka för att granska och lägga till detaljer.",
        "tr": "Ajan tarafından önerildi. İncelemek ve ayrıntı eklemek için tıklayın.",
        "uk": "Запропоновано агентом. Натисніть, щоб переглянути та додати деталі."
    },
    "planner.acceptProposalTooltip": {
        "en": "Review and add details to this proposed event",
        "de": "Details zu diesem vorgeschlagenen Ereignis überprüfen und hinzufügen",
        "fr": "Examiner et ajouter des détails à cet événement proposé",
        "cs": "Zkontrolovat a doplnit podrobnosti k této navržené události",
        "es": "Revisar y agregar detalles a este evento propuesto",
        "hu": "Részletek áttekintése és hozzáadása ehhez a javasolt eseményhez",
        "it": "Rivedi e aggiungi dettagli a questo evento proposto",
        "nl": "Bekijk en voeg details toe aan deze voorgestelde gebeurtenis",
        "pl": "Przejrzyj i dodaj szczegóły do tego proponowanego wydarzenia",
        "pt": "Revisar e adicionar detalhes a este evento proposto",
        "ro": "Revizuiți și adăugați detalii la acest eveniment propus",
        "ru": "Проверить и добавить подробности к этому предложенному событию",
        "sv": "Granska och lägg till detaljer till denna föreslagna händelse",
        "tr": "Bu önerilen etkinliği inceleyin ve ayrıntı ekleyin",
        "uk": "Переглянути та додати деталі до цієї запропонованої події"
    },
    "planner.quickAcceptProposalTooltip": {
        "en": "Quick accept this proposed event into your calendar",
        "de": "Dieses vorgeschlagene Ereignis schnell in Ihren Kalender übernehmen",
        "fr": "Accepter rapidement cet événement proposé dans votre calendrier",
        "cs": "Rychle přijmout tuto navrženou událost do kalendáře",
        "es": "Aceptar rápidamente este evento propuesto en su calendario",
        "hu": "Gyorsan elfogadja ezt a javasolt eseményt a naptárában",
        "it": "Accetta rapidamente questo evento proposto nel calendario",
        "nl": "Accepteer deze voorgestelde gebeurtenis snel in uw agenda",
        "pl": "Szybko zaakceptuj to proponowane wydarzenie w kalendarzu",
        "pt": "Aceitar rapidamente este evento proposto no seu calendário",
        "ro": "Acceptați rapid acest eveniment propus în calendar",
        "ru": "Быстро принять это предложенное событие в календарь",
        "sv": "Snabbgodkänn denna föreslagna händelse till din kalender",
        "tr": "Bu önerilen etkinliği takviminize hızlıca kabul edin",
        "uk": "Швидко прийняти цю запропоновану подію до календаря"
    },
    "planner.dismissProposalTooltip": {
        "en": "Dismiss this proposed event",
        "de": "Dieses vorgeschlagene Ereignis verwerfen",
        "fr": "Ignorer cet événement proposé",
        "cs": "Odmítnout tuto navrženou událost",
        "es": "Descartar este evento propuesto",
        "hu": "Javasolt esemény elvetése",
        "it": "Ignora questo evento proposto",
        "nl": "Dit voorgestelde evenement negeren",
        "pl": "Odrzuć to proponowane wydarzenie",
        "pt": "Descartar este evento proposto",
        "ro": "Respingeți acest eveniment propus",
        "ru": "Отклонить это предложенное событие",
        "sv": "Avvisa denna föreslagna händelse",
        "tr": "Bu önerilen etkinliği reddet",
        "uk": "Відхилити цю запропоновану подію"
    },
    "planner.proposalAccepted": {
        "en": "Proposed event added to planner",
        "de": "Vorgeschlagenes Ereignis zum Planer hinzugefügt",
        "fr": "Événement proposé ajouté au planificateur",
        "cs": "Navržená událost byla přidána do plánovače",
        "es": "Evento propuesto agregado al planificador",
        "hu": "Javasolt esemény hozzáadva a tervezőhöz",
        "it": "Evento proposto aggiunto al pianificatore",
        "nl": "Voorgestelde gebeurtenis toegevoegd aan planner",
        "pl": "Proponowane wydarzenie dodane do planera",
        "pt": "Evento proposto adicionado ao planejador",
        "ro": "Evenimentul propus a fost adăugat în planificator",
        "ru": "Предложенное событие добавлено в планировщик",
        "sv": "Föreslagen händelse lades till i planeraren",
        "tr": "Önerilen etkinlik planlayıcıya eklendi",
        "uk": "Запропоновану подію додано до планувальника"
    },
    "planner.proposalDismissed": {
        "en": "Proposed event dismissed",
        "de": "Vorgeschlagenes Ereignis verworfen",
        "fr": "Événement proposé ignoré",
        "cs": "Navržená událost byla odmítnuta",
        "es": "Evento propuesto descartado",
        "hu": "Javasolt esemény elvetve",
        "it": "Evento proposto ignorato",
        "nl": "Voorgestelde gebeurtenis genegeerd",
        "pl": "Proponowane wydarzenie odrzucone",
        "pt": "Evento proposto descartado",
        "ro": "Evenimentul propus a fost respins",
        "ru": "Предложенное событие отклонено",
        "sv": "Föreslagen händelse avvisades",
        "tr": "Önerilen etkinlik reddedildi",
        "uk": "Запропоновану подію відхилено"
    },
    "planner.proposalsDetected": {
        "en": "New proposed event(s) detected from agent",
        "de": "Neue vorgeschlagene Ereignisse vom Agenten erkannt",
        "fr": "Nouvel événement proposé détecté depuis l'agent",
        "cs": "Zjištěny nové navržené události od agenta",
        "es": "Nuevos eventos propuestos detectados desde el agente",
        "hu": "Új javasolt esemény(ek) észlelve az ügynöktől",
        "it": "Nuovi eventi proposti rilevati dall'agente",
        "nl": "Nieuwe voorgestelde gebeurtenissen gedetecteerd van agent",
        "pl": "Wykryto nowe proponowane wydarzenia od agenta",
        "pt": "Novos eventos propostos detectados do agente",
        "ro": "Noi evenimente propuse detectate de la agent",
        "ru": "Обнаружены новые предложенные события от агента",
        "sv": "Nya föreslagna händelser upptäcktes från agent",
        "tr": "Ajandan yeni önerilen etkinlikler algılandı",
        "uk": "Виявлено нові запропоновані події від агента"
    },
    "planner.reviewProposedModalTitle": {
        "en": "Review Proposed Event",
        "de": "Vorgeschlagenes Ereignis überprüfen",
        "fr": "Examiner l'événement proposé",
        "cs": "Zkontrolovat navrženou událost",
        "es": "Revisar evento propuesto",
        "hu": "Javasolt esemény áttekintése",
        "it": "Rivedi l'evento proposto",
        "nl": "Voorgestelde gebeurtenis beoordelen",
        "pl": "Przejrzyj proponowane wydarzenie",
        "pt": "Revisar evento proposto",
        "ro": "Revizuiți evenimentul propus",
        "ru": "Проверить предложенное событие",
        "sv": "Granska föreslagen händelse",
        "tr": "Önerilen Etkinliği İncele",
        "uk": "Переглянути запропоновану подію"
    }
}

file_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "js", "translations.js")

with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

json_start = content.find("{")
json_end = content.rfind("}") + 1

json_str = content[json_start:json_end]
data = json.loads(json_str)

for key, langs in new_keys.items():
    data["translations"][key] = langs

# Sort keys alphabetically
data["translations"] = dict(sorted(data["translations"].items()))

# Update total_keys count
data["metadata"]["total_keys"] = len(data["translations"])

new_content = "window.APP_TRANSLATIONS_BUNDLE = " + json.dumps(data, ensure_ascii=False, indent=2) + ";\n"

with open(file_path, "w", encoding="utf-8") as f:
    f.write(new_content)

print(f"Successfully added {len(new_keys)} translation keys to translations.js!")
