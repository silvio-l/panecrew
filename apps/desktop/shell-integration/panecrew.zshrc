# PaneCrew shell integration — generated file, do not edit.

# Restored first, before anything can go wrong: if the user's rc errors out or
# execs, ZDOTDIR must already point back at their own world. Otherwise every
# child process (sudo, ssh, a nested zsh) would start reading PaneCrew's files.
if [[ -n ${PANECREW_USER_ZDOTDIR-} && $PANECREW_USER_ZDOTDIR != $HOME ]]; then
  ZDOTDIR=$PANECREW_USER_ZDOTDIR
else
  # Unset, not "=$HOME": unset is zsh's actual default state.
  unset ZDOTDIR
fi
_panecrew_user_zdotdir=${PANECREW_USER_ZDOTDIR:-$HOME}
unset PANECREW_ZDOTDIR PANECREW_USER_ZDOTDIR

[[ -f $_panecrew_user_zdotdir/.zshrc ]] && source "$_panecrew_user_zdotdir/.zshrc"
unset _panecrew_user_zdotdir

autoload -Uz add-zsh-hook

# --- Working directory reporting (OSC 7) -------------------------------------
# The only way PaneCrew learns where a pane's shell actually is after the user
# has cd'd around. Unconditional: it prints nothing visible and is what the
# inline `cd` suggestions validate against.
_panecrew_report_cwd() {
  local url=${PWD//\%/%25}
  url=${url// /%20}
  url=${url//\#/%23}
  url=${url//\?/%3F}
  printf '\e]7;file://%s%s\a' "${HOST-}" "$url"
}
add-zsh-hook precmd _panecrew_report_cwd

# --- Prompt ------------------------------------------------------------------
# Only applied when the prompt is still an untouched OS default. Oh My Zsh,
# Starship, powerlevel10k, a hand-rolled PROMPT — all of them leave something
# else in PROMPT by this point and win.
_panecrew_prompt_is_stock() {
  [[ -z ${RPROMPT-} && -z ${RPS1-} ]] || return 1
  case $PROMPT in
    # zsh's own built-in default, and macOS /etc/zshrc's.
    '%m%# '|'%n@%m %1~ %# ') return 0 ;;
  esac
  return 1
}

if _panecrew_prompt_is_stock; then
  # Branch name without forking git: a prompt runs on every keystroke-ending
  # Enter, and `git status` on a large repo is far too slow to sit here.
  _panecrew_git_branch() {
    local dir=$PWD head
    _panecrew_branch=
    while [[ -n $dir ]]; do
      if [[ -f $dir/.git/HEAD ]]; then
        read -r head < "$dir/.git/HEAD"
        if [[ $head == ref:* ]]; then
          _panecrew_branch=${head##*/}
        else
          _panecrew_branch=${head[1,7]}
        fi
        return
      fi
      [[ $dir == / ]] && return
      dir=${dir:h}
    done
  }

  # PROMPT is rebuilt per prompt rather than left with a `${...}` in it, so
  # `setopt prompt_subst` — a global option the user did not ask for — stays
  # untouched.
  _panecrew_set_prompt() {
    _panecrew_git_branch
    PROMPT='%F{cyan}%2~%f'
    # A branch name is foreign text inside a format string; `%` doubled so it
    # cannot smuggle in prompt escapes.
    [[ -n $_panecrew_branch ]] && PROMPT+=" %F{magenta}${_panecrew_branch//\%/%%}%f"
    PROMPT+=' ❯ '
  }
  add-zsh-hook precmd _panecrew_set_prompt
fi
unset -f _panecrew_prompt_is_stock
