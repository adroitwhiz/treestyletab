/*
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
*/
'use strict';

import * as Constants from './constants.js';
import {
  log as internalLogger,
  configs
} from './common.js';

// eslint-disable-next-line no-unused-vars
function log(...args) {
  internalLogger('common/tabs', ...args);
}


let mTargetWindow;

export function setWindow(targetWindow) {
  return mTargetWindow = targetWindow;
}

export function getWindow() {
  return mTargetWindow;
}


//===================================================================
// Tab Tracking
//===================================================================

export const windows        = new Map();
export const tabs           = new Map();
export const tabsByUniqueId = new Map();

export const queryLogs = [];
const MAX_LOGS = 100000;

const MATCHING_ATTRIBUTES = `
active
attention
audible
autoDiscardable
cookieStoreId
discarded
favIconUrl
hidden
highlighted
id
incognito
index
isArticle
isInReaderMode
pinned
sessionId
status
successorId
title
url
`.trim().split(/\s+/);

export function queryAll(query) {
  if (configs.loggingQueries) {
    queryLogs.push(query);
    queryLogs.splice(0, Math.max(0, queryLogs.length - MAX_LOGS));
    if (query.tabs && query.tabs.name)
      query.indexedTabs = query.tabs.name;
  }
  fixupQuery(query);
  const startAt = Date.now();
  if (query.windowId || query.ordered) {
    let tabs = [];
    for (const window of windows.values()) {
      if (query.windowId && !matched(window.id, query.windowId))
        continue;
      const [sourceTabs, offset] = sourceTabsForQuery(query, window);
      tabs = tabs.concat(extractMatchedTabs(sourceTabs, query, offset));
    }
    query.elapsed = Date.now() - startAt;
    return tabs;
  }
  else {
    const matchedTabs = extractMatchedTabs((query.tabs || tabs).values(), query);
    query.elapsed = Date.now() - startAt;
    return matchedTabs;
  }
}

function sourceTabsForQuery(query, window) {
  let offset = 0;
  if (!query.ordered)
    return [query.tabs && query.tabs.values() || window.tabs.values(), offset];
  let fromId;
  if (typeof query.index == 'number') {
    fromId = window.order[query.index];
    offset = query.index;
  }
  if (typeof query.fromIndex == 'number') {
    fromId = window.order[query.fromIndex];
    offset = query.fromIndex;
  }
  if (typeof fromId != 'number') {
    fromId = query.fromId;
    offset = window.order.indexOf(query.fromId);
  }
  if (query.last)
    return [window.getReversedOrderedTabs(fromId, query.toId, query.tabs), offset];
  return [window.getOrderedTabs(fromId, query.toId, query.tabs), offset];
}

function extractMatchedTabs(tabs, query, offset) {
  const matchedTabs = [];
  let firstTime     = true;
  let logicalIndex  = offset || 0;

  TAB_MACHING:
  for (const tab of tabs) {
    for (const attribute of MATCHING_ATTRIBUTES) {
      if (attribute in query &&
          !matched(tab[attribute], query[attribute]))
        continue TAB_MACHING;
      if (`!${attribute}` in query &&
          matched(tab[attribute], query[`!${attribute}`]))
        continue TAB_MACHING;
    }

    if (!tab.$TST)
      continue TAB_MACHING;

    if ('states' in query && tab.$TST.states) {
      for (let i = 0, maxi = query.states.length; i < maxi; i += 2) {
        const state   = query.states[i];
        const pattern = query.states[i+1];
        if (!matched(tab.$TST.states.has(state), pattern))
          continue TAB_MACHING;
      }
    }
    if ('attributes' in query && tab.$TST.attributes) {
      for (let i = 0, maxi = query.attributes.length; i < maxi; i += 2) {
        const attribute = query.attributes[i];
        const pattern   = query.attributes[i+1];
        if (!matched(tab.$TST.attributes[attribute], pattern))
          continue TAB_MACHING;
      }
    }

    if (query.living &&
        !ensureLivingTab(tab))
      continue TAB_MACHING;
    if (query.normal &&
        (tab.hidden ||
         tab.$TST.states.has(Constants.kTAB_STATE_SHOWING) ||
         tab.pinned))
      continue TAB_MACHING;
    if (query.visible &&
        (tab.$TST.states.has(Constants.kTAB_STATE_COLLAPSED) ||
         tab.hidden ||
         tab.$TST.states.has(Constants.kTAB_STATE_SHOWING)))
      continue TAB_MACHING;
    if (query.controllable &&
        (tab.hidden ||
         tab.$TST.states.has(Constants.kTAB_STATE_SHOWING)))
      continue TAB_MACHING;
    if ('hasChild' in query &&
        query.hasChild != tab.$TST.hasChild)
      continue TAB_MACHING;
    if ('hasParent' in query &&
        query.hasParent != tab.$TST.hasParent)
      continue TAB_MACHING;

    if (!firstTime)
      logicalIndex++;
    firstTime = false;
    if ('logicalIndex' in query &&
        !matched(logicalIndex, query.logicalIndex))
      continue TAB_MACHING;

    matchedTabs.push(tab);
    if (query.first || query.last)
      break TAB_MACHING;
  }
  return matchedTabs;
}

function matched(value, pattern) {
  if (pattern instanceof RegExp &&
      !pattern.test(String(value)))
    return false;
  if (pattern instanceof Set &&
      !pattern.has(value))
    return false;
  if (Array.isArray(pattern) &&
      !pattern.includes(value))
    return false;
  if (typeof pattern == 'function' &&
      !pattern(value))
    return false;
  if (typeof pattern == 'boolean' &&
      !!value !== pattern)
    return false;
  if (typeof pattern == 'string' &&
      String(value || '') != pattern)
    return false;
  if (typeof pattern == 'number' &&
      value != pattern)
    return false;
  return true;
}

export function query(query) {
  if (configs.loggingQueries) {
    queryLogs.push(query);
    queryLogs.splice(0, Math.max(0, queryLogs.length - MAX_LOGS));
    if (query.tabs && query.tabs.name)
      query.indexedTabs = query.tabs.name;
  }
  fixupQuery(query);
  if (query.last)
    query.ordered = true;
  else
    query.first = true;
  const startAt = Date.now();
  let tabs = [];
  if (query.windowId || query.ordered) {
    for (const window of windows.values()) {
      if (query.windowId && !matched(window.id, query.windowId))
        continue;
      const [sourceTabs, offset] = sourceTabsForQuery(query, window);
      tabs = tabs.concat(extractMatchedTabs(sourceTabs, query, offset));
      if (tabs.length > 0)
        break;
    }
  }
  else {
    tabs = extractMatchedTabs((query.tabs ||tabs).values(), query);
  }
  query.elapsed = Date.now() - startAt;
  return tabs.length > 0 ? tabs[0] : null ;
}

function fixupQuery(query) {
  if (query.fromId ||
      query.toId ||
      typeof query.index == 'number' ||
      typeof query.fromIndex == 'number' ||
      typeof query.logicalIndex == 'number')
    query.ordered = true;
  if ((query.normal ||
       query.visible ||
       query.controllable ||
       query.pinned) &&
       !('living' in query))
    query.living = true;
}


//===================================================================
// Indexes for optimization
//===================================================================

export const activeTabForWindow       = new Map();
export const activeTabsInWindow      = new Map();
export const livingTabsInWindow      = new Map();
export const controllableTabsInWindow = new Map();
export const removingTabsInWindow    = new Map();
export const removedTabsInWindow     = new Map();
export const visibleTabsInWindow     = new Map();
export const selectedTabsInWindow    = new Map();
export const highlightedTabsInWindow = new Map();
export const pinnedTabsInWindow      = new Map();
export const unpinnedTabsInWindow    = new Map();
export const rootTabsInWindow        = new Map();
export const groupTabsInWindow       = new Map();
export const collapsingTabsInWindow  = new Map();
export const expandingTabsInWindow   = new Map();
export const toBeExpandedTabsInWindow = new Map();
export const subtreeCollapsableTabsInWindow = new Map();
export const draggingTabsInWindow    = new Map();
export const duplicatingTabsInWindow = new Map();
export const toBeGroupedTabsInWindow = new Map();
export const loadingTabsInWindow     = new Map();
export const unsynchronizedTabsInWindow = new Map();

function createMapWithName(name) {
  const map = new Map();
  map.name = name;
  return map;
}

export function prepareIndexesForWindow(windowId) {
  activeTabsInWindow.set(windowId, new Set());
  livingTabsInWindow.set(windowId, createMapWithName(`living tabs in window ${windowId}`));
  controllableTabsInWindow.set(windowId, createMapWithName(`controllable tabs in window ${windowId}`));
  removingTabsInWindow.set(windowId, createMapWithName(`removing tabs in window ${windowId}`));
  removedTabsInWindow.set(windowId, createMapWithName(`removed tabs in window ${windowId}`));
  visibleTabsInWindow.set(windowId, createMapWithName(`visible tabs in window ${windowId}`));
  selectedTabsInWindow.set(windowId, createMapWithName(`selected tabs in window ${windowId}`));
  highlightedTabsInWindow.set(windowId, createMapWithName(`highlighted tabs in window ${windowId}`));
  pinnedTabsInWindow.set(windowId, createMapWithName(`pinned tabs in window ${windowId}`));
  unpinnedTabsInWindow.set(windowId, createMapWithName(`unpinned tabs in window ${windowId}`));
  rootTabsInWindow.set(windowId, createMapWithName(`root tabs in window ${windowId}`));
  groupTabsInWindow.set(windowId, createMapWithName(`group tabs in window ${windowId}`));
  collapsingTabsInWindow.set(windowId, createMapWithName(`collapsing tabs in window ${windowId}`));
  expandingTabsInWindow.set(windowId, createMapWithName(`expanding tabs in window ${windowId}`));
  toBeExpandedTabsInWindow.set(windowId, createMapWithName(`to-be-expanded tabs in window ${windowId}`));
  subtreeCollapsableTabsInWindow.set(windowId, createMapWithName(`collapsable parent tabs in window ${windowId}`));
  draggingTabsInWindow.set(windowId, createMapWithName(`dragging tabs in window ${windowId}`));
  duplicatingTabsInWindow.set(windowId, createMapWithName(`duplicating tabs in window ${windowId}`));
  toBeGroupedTabsInWindow.set(windowId, createMapWithName(`to-be-grouped tabs in window ${windowId}`));
  loadingTabsInWindow.set(windowId, createMapWithName(`loading tabs in window ${windowId}`));
  unsynchronizedTabsInWindow.set(windowId, createMapWithName(`unsynchronized tabs in window ${windowId}`));
}

export function unprepareIndexesForWindow(windowId) {
  activeTabForWindow.delete(windowId);
  activeTabsInWindow.delete(windowId);
  livingTabsInWindow.delete(windowId);
  controllableTabsInWindow.delete(windowId);
  removingTabsInWindow.delete(windowId);
  removedTabsInWindow.delete(windowId);
  visibleTabsInWindow.delete(windowId);
  selectedTabsInWindow.delete(windowId);
  highlightedTabsInWindow.delete(windowId);
  pinnedTabsInWindow.delete(windowId);
  unpinnedTabsInWindow.delete(windowId);
  rootTabsInWindow.delete(windowId);
  groupTabsInWindow.delete(windowId);
  collapsingTabsInWindow.delete(windowId);
  expandingTabsInWindow.delete(windowId);
  toBeExpandedTabsInWindow.delete(windowId);
  subtreeCollapsableTabsInWindow.delete(windowId);
  toBeGroupedTabsInWindow.delete(windowId);
  loadingTabsInWindow.delete(windowId);
  unsynchronizedTabsInWindow.delete(windowId);
}

export function updateIndexesForTab(tab) {
  addLivingTab(tab);

  if (!tab.hidden)
    addControllableTab(tab);
  else
    removeControllableTab(tab);

  if (tab.hidden || tab.$TST.collapsed)
    removeVisibleTab(tab);
  else
    addVisibleTab(tab);

  if (tab.$TST.states.has(Constants.kTAB_STATE_SELECTED))
    addSelectedTab(tab);
  else
    removeSelectedTab(tab);

  if (tab.highlighted)
    addHighlightedTab(tab);
  else
    removeHighlightedTab(tab);

  if (tab.pinned) {
    removeUnpinnedTab(tab);
    addPinnedTab(tab);
  }
  else {
    removePinnedTab(tab);
    addUnpinnedTab(tab);
  }

  if (tab.$TST.isGroupTab)
    addGroupTab(tab);
  else
    removeGroupTab(tab);

  if (tab.$TST.duplicating)
    addDuplicatingTab(tab);
  else
    removeDuplicatingTab(tab);

  if (tab.$TST.getAttribute(Constants.kPERSISTENT_ORIGINAL_OPENER_TAB_ID) &&
      !tab.$TST.getAttribute(Constants.kPERSISTENT_ALREADY_GROUPED_FOR_PINNED_OPENER))
    addToBeGroupedTab(tab);
  else
    removeToBeGroupedTab(tab);

  if (tab.$TST.parent)
    removeRootTab(tab);
  else
    addRootTab(tab);

  if (tab.$TST.hasChild &&
      !tab.$TST.subtreeCollapsed &&
      !tab.$TST.collapsed)
    addSubtreeCollapsableTab(tab);
  else
    removeSubtreeCollapsableTab(tab);

  if (tab.status == 'loading')
    addLoadingTab(tab);
  else
    removeLoadingTab(tab);
}

export function removeTabFromIndexes(tab) {
  removeLivingTab(tab);
  removeControllableTab(tab);
  removeRemovingTab(tab);
  //removeRemovedTab(tab);
  removeVisibleTab(tab);
  removeSelectedTab(tab);
  removeHighlightedTab(tab);
  removePinnedTab(tab);
  removeUnpinnedTab(tab);
  removeRootTab(tab);
  removeGroupTab(tab);
  removeCollapsingTab(tab);
  removeExpandingTab(tab);
  removeToBeExpandedTab(tab);
  removeSubtreeCollapsableTab(tab);
  removeDuplicatingTab(tab);
  removeDraggingTab(tab);
  removeToBeGroupedTab(tab);
  removeLoadingTab(tab);
  removeUnsynchronizedTab(tab);
}

function addTabToIndex(tab, indexes) {
  const tabs = indexes.get(tab.windowId);
  tabs.set(tab.id, tab);
}

function removeTabFromIndex(tab, indexes) {
  const tabs = indexes.get(tab.windowId);
  if (tabs)
    tabs.delete(tab.id);
}

export function addLivingTab(tab) {
  addTabToIndex(tab, livingTabsInWindow);
}
export function removeLivingTab(tab) {
  removeTabFromIndex(tab, livingTabsInWindow);
}

export function addControllableTab(tab) {
  addTabToIndex(tab, controllableTabsInWindow);
}
export function removeControllableTab(tab) {
  removeTabFromIndex(tab, controllableTabsInWindow);
}

export function addRemovingTab(tab) {
  addTabToIndex(tab, removingTabsInWindow);
  removeTabFromIndexes(tab);
}
export function removeRemovingTab(tab) {
  removeTabFromIndex(tab, removingTabsInWindow);
}

export function addRemovedTab(tab) {
  addTabToIndex(tab, removedTabsInWindow);
  setTimeout(removeRemovedTab, 100000, {
    id:       tab.id,
    windowId: tab.windowId
  });
}
function removeRemovedTab(tab) {
  removeTabFromIndex(tab, removedTabsInWindow);
}

export function addVisibleTab(tab) {
  addTabToIndex(tab, visibleTabsInWindow);
}
export function removeVisibleTab(tab) {
  removeTabFromIndex(tab, visibleTabsInWindow);
}

export function addSelectedTab(tab) {
  addTabToIndex(tab, selectedTabsInWindow);
}
export function removeSelectedTab(tab) {
  removeTabFromIndex(tab, selectedTabsInWindow);
}

export function addHighlightedTab(tab) {
  addTabToIndex(tab, highlightedTabsInWindow);
}
export function removeHighlightedTab(tab) {
  removeTabFromIndex(tab, highlightedTabsInWindow);
}

export function addPinnedTab(tab) {
  addTabToIndex(tab, pinnedTabsInWindow);
}
export function removePinnedTab(tab) {
  removeTabFromIndex(tab, pinnedTabsInWindow);
}

export function addUnpinnedTab(tab) {
  addTabToIndex(tab, unpinnedTabsInWindow);
}
export function removeUnpinnedTab(tab) {
  removeTabFromIndex(tab, unpinnedTabsInWindow);
}

export function addRootTab(tab) {
  addTabToIndex(tab, rootTabsInWindow);
}
export function removeRootTab(tab) {
  removeTabFromIndex(tab, rootTabsInWindow);
}

export function addGroupTab(tab) {
  addTabToIndex(tab, groupTabsInWindow);
}
export function removeGroupTab(tab) {
  removeTabFromIndex(tab, groupTabsInWindow);
}

export function addCollapsingTab(tab) {
  addTabToIndex(tab, collapsingTabsInWindow);
}
export function removeCollapsingTab(tab) {
  removeTabFromIndex(tab, collapsingTabsInWindow);
}

export function addExpandingTab(tab) {
  addTabToIndex(tab, expandingTabsInWindow);
}
export function removeExpandingTab(tab) {
  removeTabFromIndex(tab, expandingTabsInWindow);
}

export function addToBeExpandedTab(tab) {
  addTabToIndex(tab, toBeExpandedTabsInWindow);
}
export function removeToBeExpandedTab(tab) {
  removeTabFromIndex(tab, toBeExpandedTabsInWindow);
}

export function addSubtreeCollapsableTab(tab) {
  addTabToIndex(tab, subtreeCollapsableTabsInWindow);
}
export function removeSubtreeCollapsableTab(tab) {
  removeTabFromIndex(tab, subtreeCollapsableTabsInWindow);
}

export function addDuplicatingTab(tab) {
  addTabToIndex(tab, duplicatingTabsInWindow);
}
export function removeDuplicatingTab(tab) {
  removeTabFromIndex(tab, duplicatingTabsInWindow);
}

export function addDraggingTab(tab) {
  addTabToIndex(tab, draggingTabsInWindow);
}
export function removeDraggingTab(tab) {
  removeTabFromIndex(tab, draggingTabsInWindow);
}

export function addToBeGroupedTab(tab) {
  addTabToIndex(tab, toBeGroupedTabsInWindow);
}
export function removeToBeGroupedTab(tab) {
  removeTabFromIndex(tab, toBeGroupedTabsInWindow);
}

export function addLoadingTab(tab) {
  addTabToIndex(tab, loadingTabsInWindow);
}
export function removeLoadingTab(tab) {
  removeTabFromIndex(tab, loadingTabsInWindow);
}

export function addUnsynchronizedTab(tab) {
  addTabToIndex(tab, unsynchronizedTabsInWindow);
}
export function removeUnsynchronizedTab(tab) {
  removeTabFromIndex(tab, unsynchronizedTabsInWindow);
}



//===================================================================
// Utilities
//===================================================================

export function assertValidTab(tab) {
  if (tab && tab.$TST)
    return;
  const error = new Error('FATAL ERROR: invalid tab is given');
  console.log(error.message, tab, error.stack);
  throw error;
}

export function ensureLivingTab(tab) {
  if (!tab ||
      !tab.id ||
      !tab.$TST ||
      (tab.$TST.element &&
       !tab.$TST.element.parentNode) ||
      !tabs.has(tab.id) ||
      tab.$TST.states.has(Constants.kTAB_STATE_REMOVING))
    return null;
  return tab;
}


//===================================================================
// Logging
//===================================================================

browser.runtime.onMessage.addListener((message, _sender) => {
  if (!message ||
      typeof message != 'object' ||
      message.type != Constants.kCOMMAND_REQUEST_QUERY_LOGS)
    return;

  browser.runtime.sendMessage({
    type: Constants.kCOMMAND_RESPONSE_QUERY_LOGS,
    logs: JSON.parse(JSON.stringify(queryLogs)),
    windowId: mTargetWindow || 'background'
  });
});