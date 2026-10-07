#!/usr/bin/env python3
import json
import sys

def get_translations_map():
    # Dictionary mapping common English UI phrases to all 14 non-English European languages
    return {
        "Accept": {
            "cs": "Přijmout", "de": "Akzeptieren", "es": "Aceptar", "fr": "Accepter", "hu": "Elfogadás",
            "it": "Accetta", "nl": "Accepteren", "pl": "Akceptuj", "pt": "Aceitar", "ro": "Acceptă",
            "ru": "Принять", "sv": "Acceptera", "tr": "Kabul Et", "uk": "Прийняти"
        },
        "Assistant": {
            "cs": "Asistent", "de": "Assistent", "es": "Asistente", "fr": "Assistant", "hu": "Asszisztens",
            "it": "Assistente", "nl": "Assistent", "pl": "Asystent", "pt": "Assistente", "ro": "Asistent",
            "ru": "Ассистент", "sv": "Assistent", "tr": "Asistan", "uk": "Асистент"
        },
        "Attached Context": {
            "cs": "Připojený kontext", "de": "Angehängter Kontext", "es": "Contexto adjunto", "fr": "Contexte joint", "hu": "Csatolt kontextus",
            "it": "Contesto allegato", "nl": "Bijgevoegde context", "pl": "Dołączony kontekst", "pt": "Contexto anexado", "ro": "Context atașat",
            "ru": "Прикрепленный контекст", "sv": "Bifogat kontext", "tr": "Eklenen Bağlam", "uk": "Прикріплений контекст"
        },
        "Are you sure you want to clear all messages in this conversation?": {
            "cs": "Opravdu chcete vymazat všechny zprávy v této konverzaci?",
            "de": "Möchten Sie wirklich alle Nachrichten in dieser Konversation löschen?",
            "es": "¿Está seguro de que desea borrar todos los mensajes de esta conversación?",
            "fr": "Voulez-vous vraiment effacer tous les messages de cette conversation ?",
            "hu": "Biztosan törölni szeretné a beszélgetés összes üzenetét?",
            "it": "Sei sicuro di voler cancellare tutti i messaggi in questa conversazione?",
            "nl": "Weet u zeker dat u alle berichten in dit gesprek wilt wissselen?",
            "pl": "Czy na pewno chcesz wyczyścić wszystkie wiadomości w tej rozmowie?",
            "pt": "Tem a certeza de que pretende limpar todas as mensagens desta conversa?",
            "ro": "Sigur doriți să ștergeți toate mesajele din această conversație?",
            "ru": "Вы уверены, что хотите очистить все сообщения в этой беседе?",
            "sv": "Är du säker på att du vill rensa alla meddelanden i den här konversationen?",
            "tr": "Bu konuşmadaki tüm mesajları temizlemek istediğinizden emin misiniz?",
            "uk": "Ви впевнені, що хочете очистити всі повідомлення в этой бесіді?"
        },
        "Prepare Meeting Call": {
            "cs": "Příprava schůzky", "de": "Meeting vorbereiten", "es": "Preparar reunión", "fr": "Préparer la réunion", "hu": "Megbeszélés előkészítése",
            "it": "Prepara riunione", "nl": "Vergadering voorbereiden", "pl": "Przygotuj spotkanie", "pt": "Preparar reunião", "ro": "Pregătește ședința",
            "ru": "Подготовить встречу", "sv": "Förbered möte", "tr": "Toplantıyı Hazırla", "uk": "Підготувати зустріч"
        },
        "Summarize Last 3 Days": {
            "cs": "Shrnutí posledních 3 dnů", "de": "Zusammenfassung der letzten 3 Tage", "es": "Resumen de los últimos 3 días", "fr": "Résumer les 3 derniers jours", "hu": "Elúlt 3 nap összefoglalása",
            "it": "Riepilogo ultimi 3 giorni", "nl": "Samenvatting laatste 3 dagen", "pl": "Podsumuj ostatnie 3 dni", "pt": "Resumir últimos 3 dias", "ro": "Rezumat ultimele 3 zile",
            "ru": "Резюме за последние 3 дня", "sv": "Sammanfatta senaste 3 dagarna", "tr": "Son 3 Günü Özetle", "uk": "Резюме за останні 3 дні"
        },
        "Summarize Last 7 Days": {
            "cs": "Shrnutí posledních 7 dnů", "de": "Zusammenfassung der letzten 7 Tage", "es": "Resumen de los últimos 7 días", "fr": "Résumer les 7 derniers jours", "hu": "Elúlt 7 nap összefoglalása",
            "it": "Riepilogo ultimi 7 giorni", "nl": "Samenvatting laatste 7 dagen", "pl": "Podsumuj ostatnie 7 dni", "pt": "Resumir últimos 7 dias", "ro": "Rezumat ultimele 7 zile",
            "ru": "Резюме за последние 7 дней", "sv": "Sammanfatta senaste 7 dagarna", "tr": "Son 7 Günü Özetle", "uk": "Резюме за останні 7 днів"
        },
        "Draft Weekly Report": {
            "cs": "Připravit týdenní zprávu", "de": "Wochenbericht erstellen", "es": "Redactar informe semanal", "fr": "Rédiger le rapport hebdomadaire", "hu": "Heti jelentés vázlata",
            "it": "Redigi report settimanale", "nl": "Weekrapport opstellen", "pl": "Przygotuj raport tygodniowy", "pt": "Redigir relatório semanal", "ro": "Redactează raportul săptămânal",
            "ru": "Составить еженедельный отчет", "sv": "Skriv veckorapport", "tr": "Haftalık Rapor Taslağı Hazırla", "uk": "Скласти тижневий звіт"
        },
        "Conversations": {
            "cs": "Konverzace", "de": "Konversationen", "es": "Conversaciones", "fr": "Conversations", "hu": "Beszélgetések",
            "it": "Conversazioni", "nl": "Gesprekken", "pl": "Rozmowy", "pt": "Conversas", "ro": "Conversații",
            "ru": "Беседы", "sv": "Konversationer", "tr": "Konuşmalar", "uk": "Бесіди"
        },
        "Are you sure you want to delete this conversation?": {
            "cs": "Opravdu chcete smazat tuto konverzaci?",
            "de": "Möchten Sie diese Konversation wirklich löschen?",
            "es": "¿Está seguro de que desea eliminar esta conversación?",
            "fr": "Voulez-vous vraiment supprimer cette conversation ?",
            "hu": "Biztosan törölni szeretné ezt a beszélgetést?",
            "it": "Sei sicuro di voler eliminare questa conversazione?",
            "nl": "Weet u zeker dat u dit gesprek wilt verwijderen?",
            "pl": "Czy na pewno chcesz usunąć tę rozmowę?",
            "pt": "Tem a certeza de que pretende eliminar esta conversa?",
            "ro": "Sigur doriți să ștergeți această conversație?",
            "ru": "Вы уверены, что хотите удалить эту беседу?",
            "sv": "Är du säker på att du vill radera den här konversationen?",
            "tr": "Bu konuşmayı silmek istediğinizden emin misiniz?",
            "uk": "Ви впевнені, що хочете видалити цю бесіду?"
        },
        "Dismiss": {
            "cs": "Zavřít", "de": "Verwerfen", "es": "Descartar", "fr": "Ignorer", "hu": "Elvetés",
            "it": "Chiudi", "nl": "Negeren", "pl": "Odrzuć", "pt": "Descartar", "ro": "Respinge",
            "ru": "Закрыть", "sv": "Avfärda", "tr": "Kapat", "uk": "Закрити"
        },
        "Error": {
            "cs": "Chyba", "de": "Fehler", "es": "Error", "fr": "Erreur", "hu": "Hiba",
            "it": "Errore", "nl": "Fout", "pl": "Błąd", "pt": "Erro", "ro": "Eroare",
            "ru": "Ошибка", "sv": "Fel", "tr": "Hata", "uk": "Помилка"
        },
        "History": {
            "cs": "Historie", "de": "Verlauf", "es": "Historial", "fr": "Historique", "hu": "Előzmények",
            "it": "Cronologia", "nl": "Geschiedenis", "pl": "Historia", "pt": "Histórico", "ro": "Istoric",
            "ru": "История", "sv": "Historik", "tr": "Geçmiş", "uk": "Історія"
        },
        "New Chat": {
            "cs": "Nový chat", "de": "Neuer Chat", "es": "Nuevo chat", "fr": "Nouveau chat", "hu": "Új csevegés",
            "it": "Nuova chat", "nl": "Nieuw gesprek", "pl": "Nowy czat", "pt": "Nova conversa", "ro": "Chat nou",
            "ru": "Новый чат", "sv": "Ny chatt", "tr": "Yeni Sohbet", "uk": "Новий чат"
        },
        "No attachments": {
            "cs": "Žádné přílohy", "de": "Keine Anhänge", "es": "Sin archivos adjuntos", "fr": "Aucune pièce jointe", "hu": "Nincsenek csatolmányok",
            "it": "Nessun allegato", "nl": "Geen bijlagen", "pl": "Brak załączników", "pt": "Sem anexos", "ro": "Fără atașamente",
            "ru": "Нет вложений", "sv": "Inga bilagor", "tr": "Ek yok", "uk": "Немає вкладень"
        },
        "No conversations found": {
            "cs": "Nenalezeny žádné konverzace", "de": "Keine Konversationen gefunden", "es": "No se encontraron conversaciones", "fr": "Aucune conversation trouvée", "hu": "Nem található beszélgetés",
            "it": "Nessuna conversazione trovata", "nl": "Geen gesprekken gevonden", "pl": "Nie znaleziono rozmów", "pt": "Nenhuma conversa encontrada", "ro": "Nu s-au găsit conversații",
            "ru": "Беседы не найдены", "sv": "Inga konversationer hittades", "tr": "Konuşma bulunamadı", "uk": "Бесіди не знайдені"
        },
        "No notes found": {
            "cs": "Nenalezeny žádné poznámky", "de": "Keine Notizen gefunden", "es": "No se encontraron notas", "fr": "Aucune note trouvée", "hu": "Nem található jegyzet",
            "it": "Nessuna nota trovata", "nl": "Geen notities gevonden", "pl": "Nie znaleziono notatek", "pt": "Nenhuma nota encontrada", "ro": "Nu s-au găsit note",
            "ru": "Заметки не найдены", "sv": "Inga anteckningar hittades", "tr": "Not bulunamadı", "uk": "Замітки не знайдені"
        },
        "No tasks found": {
            "cs": "Nenalezeny žádné úkoly", "de": "Keine Aufgaben gefunden", "es": "No se encontraron tareas", "fr": "Aucune tâche trouvée", "hu": "Nem található feladat",
            "it": "Nessun compito trovato", "nl": "Geen taken gevonden", "pl": "Nie znaleziono zadań", "pt": "Nenhuma tarefa encontrada", "ro": "Nu s-au găsit sarcini",
            "ru": "Задачи не найдены", "sv": "Inga uppgifter hittades", "tr": "Görev bulunamadı", "uk": "Завдання не знайдені"
        },
        "How to setup your local AI Agent": {
            "cs": "Jak nastavit lokálního AI agenta", "de": "Einrichtung Ihres lokalen KI-Agenten", "es": "Cómo configurar su agente de IA local", "fr": "Comment configurer votre agent IA local", "hu": "Hogyan állítsa be a helyi AI ügynököt",
            "it": "Come configurare il tuo agente IA locale", "nl": "Hoe uw lokale AI-agent in te stellen", "pl": "Jak skonfigurować lokalnego agenta AI", "pt": "Como configurar o seu agente de IA local", "ro": "Cum să configurați agentul AI local",
            "ru": "Как настроить локального ИИ-агента", "sv": "Hur du ställer in din lokala AI-agent", "tr": "Yerel AI Ajanınızı nasıl kurarsınız", "uk": "Як налаштувати локального ШІ-агента"
        },
        "Quick Commands": {
            "cs": "Rychlé příkazy", "de": "Schnellbefehle", "es": "Comandos rápidos", "fr": "Commandes rapides", "hu": "Gyors parancsok",
            "it": "Comandi rapidi", "nl": "Snelle opdrachten", "pl": "Szybkie polecenia", "pt": "Comandos rápidos", "ro": "Comenzi rapide",
            "ru": "Быстрые команды", "sv": "Snabbkommandon", "tr": "Hızlı Komutlar", "uk": "Швидкі команди"
        },
        "Enter new title for this conversation:": {
            "cs": "Zadejte nový název této konverzace:", "de": "Geben Sie einen neuen Titel für diese Konversation ein:", "es": "Introduzca el nuevo título de esta conversación:", "fr": "Saisissez un nouveau titre pour cette conversation :", "hu": "Adja meg a beszélgetés új címét:",
            "it": "Inserisci un nuovo titolo per questa conversazione:", "nl": "Voer een nieuwe titel in voor dit gesprek:", "pl": "Wprowadź nowy tytuł tej rozmowy:", "pt": "Introduza um novo título para esta conversa:", "ro": "Introduceți un titlu nou pentru această conversație:",
            "ru": "Введите новое название для этой беседы:", "sv": "Ange en ny titel för den här konversationen:", "tr": "Bu konuşma için yeni bir başlık girin:", "uk": "Введіть новую назву для этой бесіди:"
        },
        "Rename conversation": {
            "cs": "Přejmenovat konverzaci", "de": "Konversation umbenennen", "es": "Renombrar conversación", "fr": "Renommer la conversation", "hu": "Beszélgetés átnevezése",
            "it": "Rinomina conversazione", "nl": "Gesprek hernoemen", "pl": "Zmień nazwę rozmowy", "pt": "Renomear conversa", "ro": "Redenumire conversație",
            "ru": "Переименовать беседу", "sv": "Döp om konversation", "tr": "Konuşmayı Yeniden Adlandır", "uk": "Перейменувати бесіду"
        },
        "Actions": {
            "cs": "Akce", "de": "Aktionen", "es": "Acciones", "fr": "Actions", "hu": "Műveletek",
            "it": "Azioni", "nl": "Acties", "pl": "Akcje", "pt": "Ações", "ro": "Acțiuni",
            "ru": "Действия", "sv": "Åtgärder", "tr": "Eylemler", "uk": "Дії"
        },
        "Generation stopped.": {
            "cs": "Generování zastaveno.", "de": "Generierung gestoppt.", "es": "Generación detenida.", "fr": "Génération arrêtée.", "hu": "Generálás leállítva.",
            "it": "Generazione interrotta.", "nl": "Generatie gestopt.", "pl": "Generowanie zatrzymane.", "pt": "Geração interrompida.", "ro": "Generare oprită.",
            "ru": "Генерация остановлена.", "sv": "Generering stoppad.", "tr": "Oluşturma durduruldu.", "uk": "Генерацію зупинено."
        },
        "Stopping...": {
            "cs": "Zastavování...", "de": "Stoppen...", "es": "Deteniendo...", "fr": "Arrêt en cours...", "hu": "Leállítás...",
            "it": "Arresto in corso...", "nl": "Stoppen...", "pl": "Zatrzymywanie...", "pt": "A parar...", "ro": "Se oprește...",
            "ru": "Остановка...", "sv": "Stoppar...", "tr": "Durduruluyor...", "uk": "Зупинка..."
        },
        "Schedule Meeting": {
            "cs": "Naplánovat schůzku", "de": "Meeting planen", "es": "Programar reunión", "fr": "Planifier une réunion", "hu": "Megbeszélés ütemezése",
            "it": "Pianifica riunione", "nl": "Vergadering plannen", "pl": "Zaplanuj spotkanie", "pt": "Agendar reunião", "ro": "Programează ședința",
            "ru": "Запланировать встречу", "sv": "Boka möte", "tr": "Toplantı Planla", "uk": "Запланувати зустріч"
        },
        "AI Chat": {
            "cs": "AI Chat", "de": "KI-Chat", "es": "Chat IA", "fr": "Chat IA", "hu": "AI Csevegés",
            "it": "Chat IA", "nl": "AI Chat", "pl": "Czat AI", "pt": "Chat IA", "ro": "Chat AI",
            "ru": "ИИ-Чат", "sv": "AI-chatt", "tr": "Yapay Zeka Sohbeti", "uk": "ШІ-Чат"
        },
        "New Conversation": {
            "cs": "Nová konverzace", "de": "Neue Konversation", "es": "Neue Konversation", "fr": "Nouvelle conversation", "hu": "Új beszélgetés",
            "it": "Nuova conversazione", "nl": "Nieuw gesprek", "pl": "Nowa rozmowa", "pt": "Nova conversa", "ro": "Conversație nouă",
            "ru": "Новая беседа", "sv": "Ny konversation", "tr": "Yeni Konuşma", "uk": "Нова бесіда"
        },
        "All colleagues": {
            "cs": "Všichni kolegové", "de": "Alle Kolleginnen & Kollegen", "es": "Todos los colegas", "fr": "Tous les collègues", "hu": "Minden kolléga",
            "it": "Tutti i colleghi", "nl": "Alle collega's", "pl": "Wszyscy koledzy", "pt": "Todos os colegas", "ro": "Toți colegii",
            "ru": "Все коллеги", "sv": "Alla kollegor", "tr": "Tüm Meslektaşlar", "uk": "Усі колеги"
        },
        "My colleagues": {
            "cs": "Moje kolegové", "de": "Meine Kolleginnen & Kollegen", "es": "Mis colegas", "fr": "Mes collègues", "hu": "Kollégáim",
            "it": "I miei colleghi", "nl": "Mijn collega's", "pl": "Moi koledzy", "pt": "Meus colegas", "ro": "Colegii mei",
            "ru": "Мои коллеги", "sv": "Mina kollegor", "tr": "Meslektaşlarım", "uk": "Мої колеги"
        },
        "Tag Bank": {
            "cs": "Banka štítků", "de": "Tag-Bank", "es": "Banco de etiquetas", "fr": "Banque de tags", "hu": "Címkebank",
            "it": "Banca dei tag", "nl": "Tagbank", "pl": "Bank tagów", "pt": "Banco de etiquetas", "ro": "Bancă de etichete",
            "ru": "Банк тегов", "sv": "Taggbank", "tr": "Etiket Bankası", "uk": "Банк тегів"
        }
    }

def main():
    sys.path.append(os.path.dirname(os.path.realpath(__file__)))
    from i18n_utils import load_translations_bundle, save_translations_bundle

    data = load_translations_bundle('js/translations.js')

    translations = data.get('translations', {})
    trans_map = get_translations_map()
    langs = ['cs', 'de', 'es', 'fr', 'hu', 'it', 'nl', 'pl', 'pt', 'ro', 'ru', 'sv', 'tr', 'uk']

    updated_count = 0
    for key, values in translations.items():
        if not isinstance(values, dict): continue
        en_val = values.get('en', '')
        if not isinstance(en_val, str) or not en_val: continue

        # Check if we have exact rule translation
        if en_val in trans_map:
            rule = trans_map[en_val]
            for l in langs:
                if l in rule:
                    values[l] = rule[l]
                    updated_count += 1

    print(f"Updated {updated_count} translation entries.")

    save_translations_bundle(data, 'js/translations.js')

if __name__ == '__main__':
    main()
