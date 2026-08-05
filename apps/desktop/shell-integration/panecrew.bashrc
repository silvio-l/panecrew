# PaneCrew shell integration — generated file, do not edit.
#
# Reached via `bash --rcfile <this file>`, which replaces ~/.bashrc for an
# interactive non-login shell — so the user's own rc is sourced here first.
# Note for whoever adds `-l` to the spawn: bash ignores --rcfile for login
# shells, and this file would silently stop running.

[[ -f $HOME/.bashrc ]] && source "$HOME/.bashrc"

# --- Working directory reporting (OSC 7) -------------------------------------
_panecrew_report_cwd() {
  local url=${PWD//\%/%25}
  url=${url// /%20}
  url=${url//\#/%23}
  url=${url//\?/%3F}
  printf '\e]7;file://%s%s\a' "${HOSTNAME-}" "$url"
}

# --- Prompt ------------------------------------------------------------------
_panecrew_prompt_is_stock() {
  case $PS1 in
    # bash's own built-in default, macOS /etc/bashrc's, and the widespread
    # /etc/bashrc default on Red-Hat-family systems.
    '\s-\v\$ '|'\h:\W \u\$ '|'[\u@\h \W]\$ ') return 0 ;;
  esac
  return 1
}

if _panecrew_prompt_is_stock; then
  _panecrew_git_branch() {
    local dir=$PWD head
    _panecrew_branch=
    while [[ -n $dir ]]; do
      if [[ -f $dir/.git/HEAD ]]; then
        read -r head < "$dir/.git/HEAD"
        if [[ $head == ref:* ]]; then
          _panecrew_branch=${head##*/}
        else
          _panecrew_branch=${head:0:7}
        fi
        return
      fi
      [[ $dir == / ]] && return
      dir=${dir%/*}
      [[ -z $dir ]] && dir=/
    done
  }

  _panecrew_set_prompt() {
    _panecrew_git_branch
    if [[ -n $_panecrew_branch ]]; then
      _panecrew_vcs=" \[\033[35m\]${_panecrew_branch}\[\033[0m\]"
    else
      _panecrew_vcs=
    fi
  }
  # `\w` trimmed to its last two components, bash's equivalent of zsh's `%2~`.
  PROMPT_DIRTRIM=2
  PS1='\[\033[36m\]\w\[\033[0m\]${_panecrew_vcs} ❯ '
fi
unset -f _panecrew_prompt_is_stock

_panecrew_precmd() {
  _panecrew_report_cwd
  declare -F _panecrew_set_prompt >/dev/null && _panecrew_set_prompt
}
# Appended, never replaced: whatever the user's rc installed keeps running,
# and runs first.
PROMPT_COMMAND="${PROMPT_COMMAND:+$PROMPT_COMMAND$'\n'}_panecrew_precmd"
