/*
 * Copyright (c) 2020 SUSE LLC
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
#define _GNU_SOURCE
#include <assert.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <fcntl.h>
#include <glib.h>
#include <glib/gstdio.h>
#include <libsecret/secret.h>
#include <sys/stat.h>
#include <sys/types.h>

// FIXME: at the moment it is not possible to use keytar.findPassword(), because
// that calls secret_password_lookup_sync with only the service as the variadic
// parameter and not the account too.

#define UNUSED(var) (void)var

void secret_password_free(char *password) { g_free(password); }

static GQuark quark;

static gboolean get_ini_location(char **ini_path, GError **error) {
  *error = NULL;
  const char *home = secure_getenv("HOME");
  if (home == NULL) {
    *error = g_error_new(quark, 0,
                         "environment variable HOME not set (are we running in "
                         "a secure context?)");
    return FALSE;
  }

  const gboolean err = asprintf(ini_path, "%s/passwords.ini", home) == -1;
  if (err) {
    *error = g_error_new(
        quark, 0, "could not create string with the path to passwords.ini");
  }
  return !err;
}

__attribute__((constructor)) void init() {
  static const char* quark_str = "MOCKLIBSECRET_ERROR";
  quark = g_quark_from_static_string(quark_str);

  g_autofree gchar *ini_path;
  GError *err = NULL;
  get_ini_location(&ini_path, &err);

  const int fd = g_open(ini_path, O_CREAT, S_IRUSR | S_IWUSR | S_IRGRP);
  g_close(fd, &err);
}

static gboolean open_ini_file(GKeyFile *key_file, GError **error) {
  *error = NULL;

  g_autofree gchar *ini_path;
  get_ini_location(&ini_path, error);
  if (!g_key_file_load_from_file(
          key_file, ini_path,
          G_KEY_FILE_KEEP_COMMENTS | G_KEY_FILE_KEEP_TRANSLATIONS, error)) {
    if (!g_error_matches(*error, G_FILE_ERROR, G_FILE_ERROR_NOENT))
      g_warning("Error loading key file: %s", (*error)->message);
    return FALSE;
  }

  return TRUE;
}

static gboolean label_from_va_args(gchar **service, gchar **account,
                                   GError **error, va_list argp) {
  *error = NULL;
  const char *expect_service = va_arg(argp, const char *);
  if (g_strcmp0("service", expect_service) != 0) {
    *error =
        g_error_new(quark, 0, "invalid first parameter: '%s'", expect_service);
    return FALSE;
  }
  *service = g_strdup(va_arg(argp, char *));

  const char *expect_account = va_arg(argp, const char *);
  if (g_strcmp0("account", expect_account) != 0) {
    *error =
        g_error_new(quark, 0, "invalid third parameter: '%s'", expect_account);
    return FALSE;
  }
  *account = g_strdup(va_arg(argp, char *));

  if (va_arg(argp, void *) != NULL) {
    *error = g_error_new(quark, 0, "invalid last parameter, should be NULL");
    return FALSE;
  }

  return TRUE;
}

gboolean secret_password_store_sync(const SecretSchema *schema,
                                    const gchar *collection, const gchar *label,
                                    const gchar *password,
                                    GCancellable *cancellable, GError **error,
                                    ...) {
  UNUSED(schema);
  UNUSED(collection);
  UNUSED(label);
  UNUSED(cancellable);

  *error = NULL;

  g_autoptr(GKeyFile) key_file = g_key_file_new();
  g_autofree gchar *ini_path;
  if (!get_ini_location(&ini_path, error)) {
    return FALSE;
  }

  gboolean retval = TRUE;

  if (!g_key_file_load_from_file(
          key_file, ini_path,
          G_KEY_FILE_KEEP_COMMENTS | G_KEY_FILE_KEEP_TRANSLATIONS, error)) {
    if (!g_error_matches(*error, G_FILE_ERROR, G_FILE_ERROR_NOENT))
      g_warning("Error loading key file: %s", (*error)->message);
    return FALSE;
  }

  g_autofree gchar *service;
  g_autofree gchar *account;
  va_list argp;
  va_start(argp, error);
  if (!label_from_va_args(&service, &account, error, argp)) {
    va_end(argp);
    return FALSE;
  }
  va_end(argp);

  g_key_file_set_string(key_file, service, account, password);

  if (!g_key_file_save_to_file(key_file, ini_path, error)) {
    g_warning("Error saving key file: %s", (*error)->message);
    return FALSE;
  }

  return retval;
}

gchar *secret_password_lookup_sync(const SecretSchema *schema,
                                   GCancellable *cancellable, GError **error,
                                   ...) {
  UNUSED(schema);
  UNUSED(cancellable);

  *error = NULL;

  g_autofree char *ini_path;
  if (!get_ini_location(&ini_path, error)) {
    return NULL;
  }

  g_autoptr(GKeyFile) key_file = g_key_file_new();

  va_list argp;
  va_start(argp, error);

  g_autofree gchar *service;
  g_autofree gchar *account;

  if (!label_from_va_args(&service, &account, error, argp)) {
    va_end(argp);
    return NULL;
  }
  va_end(argp);

  if (!open_ini_file(key_file, error)) {
    return NULL;
  }

  gchar *retval = g_key_file_get_string(key_file, service, account, error);
  if (retval == NULL && !g_error_matches(*error, G_KEY_FILE_ERROR,
                                         G_KEY_FILE_ERROR_KEY_NOT_FOUND)) {
    g_warning("Error finding key in key file: %s", (*error)->message);
    return NULL;
  }

  return retval;
}

gboolean secret_password_clear_sync(const SecretSchema *schema,
                                    GCancellable *cancellable, GError **error,
                                    ...) {
  UNUSED(schema);
  UNUSED(cancellable);

  *error = NULL;

  g_autofree gchar *service;
  g_autofree gchar *account;
  va_list argp;
  va_start(argp, error);

  if (!label_from_va_args(&service, &account, error, argp)) {
    va_end(argp);
    return FALSE;
  }
  va_end(argp);

  g_autoptr(GKeyFile) key_file = g_key_file_new();

  if (!open_ini_file(key_file, error)) {
    return FALSE;
  }

  if (!g_key_file_remove_key(key_file, service, account, error)) {
    if (g_error_matches(*error, G_KEY_FILE_ERROR,
                        G_KEY_FILE_ERROR_KEY_NOT_FOUND)) {
      g_warning("Error finding key in key file: %s", (*error)->message);
    }
    return FALSE;
  }

  g_autofree gchar *ini_path;
  if (!get_ini_location(&ini_path, error)) {
    return FALSE;
  }

  if (!g_key_file_save_to_file(key_file, ini_path, error)) {
    g_warning("Error saving key file: %s", (*error)->message);
    return FALSE;
  }

  return TRUE;
}

gboolean key_match_find(gpointer key, gpointer value, gpointer user_data) {
  UNUSED(value);
  return g_strcmp0(key, user_data) == 0;
}

GList *secret_service_search_sync(SecretService *service,
                                  const SecretSchema *schema,
                                  GHashTable *attributes,
                                  SecretSearchFlags flags,
                                  GCancellable *cancellable, GError **error) {
  *error = NULL;

  UNUSED(service);
  UNUSED(schema);
  UNUSED(cancellable);
  UNUSED(attributes);

  *error = NULL;

  if (flags !=
      (SECRET_SEARCH_ALL | SECRET_SEARCH_UNLOCK | SECRET_SEARCH_LOAD_SECRETS)) {
    *error = g_error_new(quark, 0, "got wrong flags from keytar: %d", flags);
    return NULL;
  }


  const gchar *service_name =
      g_hash_table_find(attributes, key_match_find, (gpointer) "service");

  if (service_name == NULL) {

    *error = g_error_new(quark, 0,
                         "could not get the service name from the hash table");
    return NULL;
  }

  g_autoptr(GKeyFile) key_file = g_key_file_new();
  if (!open_ini_file(key_file, error)) {
    return NULL;
  }

  gsize length = 0;
  gchar **keys = g_key_file_get_keys(key_file, service_name, &length, error);
  // key not found => no passwords stored => not an error!
  if ((keys == NULL) && ((*error)->code == G_KEY_FILE_ERROR_GROUP_NOT_FOUND)) {
    *error = NULL;
    return NULL;
  }

  GList *l = NULL;

  for (gsize i = 0; i < length; ++i) {
    GHashTable *secret_item =
        g_hash_table_new_full(g_str_hash, g_str_equal, NULL, g_free);
    gchar *password =
        g_key_file_get_string(key_file, service_name, keys[i], error);
    // the only possible errors are: group not found or key not found, which
    // both must not happen
    assert(password != NULL);

    g_hash_table_replace(secret_item, "account", g_strdup(keys[i]));
    g_hash_table_replace(secret_item, "password", password);

    l = g_list_append(l, secret_item);
  }

  g_strfreev(keys);
  return l;
}

GHashTable *secret_item_get_attributes(SecretItem *self) {
  return (GHashTable *)self;
}

SecretValue *secret_item_get_secret(SecretItem *self) {
  return (SecretValue *)self;
}

const gchar *secret_value_get_text(SecretValue *value) {
  GHashTable *secret_item = (GHashTable *)value;
  return g_hash_table_lookup(secret_item, "password");
}

const gchar *secret_value_get_content_type(SecretValue *value) {
  return (const gchar *)value;
}
